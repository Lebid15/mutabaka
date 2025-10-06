import { environment } from '../config/environment';
import { getAccessToken, subscribeToAuthTokenChanges } from './authStorage';
import { emitConversationPreviewUpdate } from './conversationEvents';
import { createWebSocket } from './wsClient';

type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closing';

type ConnectionListener = (state: ConnectionState) => void;

type ReconnectReason =
  | 'session-available'
  | 'ensure'
  | 'foreground'
  | 'reconnect'
  | 'error'
  | 'missing-token';

function normalizeUnreadCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? 0 : Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed < 0 ? 0 : parsed;
    }
  }
  return undefined;
}

class InboxSocketManager {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shouldRun = false;
  private isForeground = true;
  private connecting = false;
  private reconnectAttempts = 0;
  private listeners = new Set<ConnectionListener>();

  constructor() {
    subscribeToAuthTokenChanges((tokens) => {
      const hasSession = Boolean(tokens?.accessToken);
      this.shouldRun = hasSession;
      if (!hasSession) {
        this.log('🔒 Tokens cleared, tearing down connection');
        this.disconnect('session-lost');
      } else {
        this.log('🔓 Tokens detected, ensuring connection');
        this.ensureConnection('session-available');
      }
    });
  }

  addStateListener(listener: ConnectionListener, options?: { emitImmediately?: boolean }): () => void {
    this.listeners.add(listener);
    if (options?.emitImmediately ?? true) {
      listener(this.socket ? 'open' : this.connecting ? 'connecting' : 'idle');
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensureConnection(reason: ReconnectReason = 'ensure'): void {
    void this.maybeConnect(reason);
  }

  setForeground(isForeground: boolean): void {
    if (this.isForeground === isForeground) {
      return;
    }
    this.isForeground = isForeground;
    this.log(isForeground ? '🌞 App foregrounded, resuming connection' : '🌙 App backgrounded, suspending connection');
    if (isForeground) {
      this.ensureConnection('foreground');
    } else {
      this.disconnect('backgrounded');
    }
  }

  private async maybeConnect(reason: ReconnectReason): Promise<void> {
    if (!this.shouldRun) {
      this.log(`[maybeConnect] Skipping (${reason}) - session not available`);
      return;
    }
    if (!this.isForeground) {
      this.log(`[maybeConnect] Skipping (${reason}) - app is backgrounded`);
      return;
    }
    if (this.connecting) {
      this.log(`[maybeConnect] Already connecting, skipping (${reason})`);
      return;
    }
    if (this.socket) {
      const state = this.socket.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        this.log(`[maybeConnect] Socket already active (state=${state}) for reason ${reason}`);
        return;
      }
    }

    this.connecting = true;
    this.notifyState('connecting');
    this.clearReconnectTimer();

    try {
      const token = await getAccessToken();
      if (!token) {
        this.log('❌ No access token available while attempting to connect');
        this.scheduleReconnect('missing-token', 5000);
        return;
      }

      const baseUrl = `${environment.websocketBaseUrl.replace(/\/+$/, '')}/inbox/`;
      this.cleanupSocket();
      const socket = createWebSocket(baseUrl, {
        token,
        query: {
          tenant: environment.tenantHost,
          tenant_host: environment.tenantHost,
        },
      });

      this.socket = socket;
      this.reconnectAttempts = 0;
      this.attachSocketHandlers(socket);
      this.log('🚀 Inbox WebSocket connection initiated');
    } catch (error) {
      this.log('❌ Failed to open inbox WebSocket connection', error);
      this.scheduleReconnect('error');
    } finally {
      this.connecting = false;
    }
  }

  private attachSocketHandlers(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.log('✅ Inbox socket opened');
      this.notifyState('open');
      this.startHeartbeat(socket);
      this.reconnectAttempts = 0;
    };

    socket.onmessage = (event) => {
      if (!event.data) {
        this.log('⚠️ Received empty inbox message');
        return;
      }
      try {
        const payload = JSON.parse(event.data as string) as Record<string, unknown> | null;
        const type = typeof payload?.type === 'string' ? payload!.type : undefined;

        switch (type) {
          case 'pong':
            this.log('💚 Heartbeat acknowledged (pong)');
            return;
          case 'inbox.hello':
            this.log('👋 Received inbox.hello handshake');
            return;
          case 'inbox.update': {
            const conversationIdRaw = payload?.conversation_id ?? payload?.conversationId;
            const conversationId = typeof conversationIdRaw === 'number'
              ? conversationIdRaw
              : Number.parseInt(String(conversationIdRaw ?? ''), 10);
            if (!Number.isFinite(conversationId)) {
              this.log('⚠️ Received inbox.update with invalid conversation id', conversationIdRaw);
              return;
            }
            const rawUnread = payload?.unread_count ?? payload?.unreadCount ?? payload?.unread;
            const unreadCount = normalizeUnreadCount(rawUnread);
            const lastMessagePreview = (payload?.last_message_preview ?? payload?.lastMessagePreview ?? payload?.preview) as string | null | undefined;
            const lastMessageAt = (payload?.last_message_at ?? payload?.lastMessageAt) as string | null | undefined;
            const lastActivityAt = (payload?.last_activity_at ?? payload?.lastActivityAt ?? lastMessageAt) as string | null | undefined;

            emitConversationPreviewUpdate({
              id: conversationId,
              lastMessagePreview: typeof lastMessagePreview === 'string' ? lastMessagePreview : undefined,
              lastMessageAt: typeof lastMessageAt === 'string' ? lastMessageAt : undefined,
              lastActivityAt: typeof lastActivityAt === 'string' ? lastActivityAt : undefined,
              unreadCount,
            });
            return;
          }
          default:
            this.log('⚠️ Received unrecognized inbox message type', type);
        }
      } catch (error) {
        this.log('❌ Failed to parse inbox socket message', error);
      }
    };

    socket.onerror = (event: any) => {
      this.log('❌ Inbox socket error', {
        type: event?.type,
        message: event?.message,
      });
      try {
        socket.close();
      } catch (error) {
        this.log('⚠️ Failed to close socket after error', error);
      }
    };

    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.stopHeartbeat();
        this.socket = null;
      }
      this.notifyState('closing');
      this.log('🔴 Inbox socket closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });

      if (!this.shouldRun) {
        this.log('🛑 Session not available, skipping reconnect');
        return;
      }
      if (!this.isForeground) {
        this.log('🛌 App backgrounded, skip reconnect until foregrounded');
        return;
      }
      if (event.code === 4001) {
        this.log('❌ Authentication failure (4001), will not reconnect automatically');
        return;
      }

      this.scheduleReconnect('reconnect');
    };
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
        this.log('💓 Heartbeat ping sent');
      } catch (error) {
        this.log('❌ Failed to send heartbeat ping', error);
      }
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private disconnect(reason: 'backgrounded' | 'session-lost'): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.socket) {
      this.log(`⏹️ Closing inbox socket due to ${reason}`);
      try {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        this.socket.close();
      } catch (error) {
        this.log('⚠️ Error while closing socket', error);
      }
      this.socket = null;
    }
    this.connecting = false;
    this.notifyState('idle');
  }

  private cleanupSocket(): void {
    if (!this.socket) {
      return;
    }
    try {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
    } catch (error) {
      this.log('⚠️ Error while cleaning up existing socket', error);
    }
    this.socket = null;
  }

  private scheduleReconnect(reason: ReconnectReason, explicitDelay?: number): void {
    if (!this.shouldRun || !this.isForeground) {
      this.log(`[scheduleReconnect] Skipping (${reason}) - shouldRun=${this.shouldRun}, isForeground=${this.isForeground}`);
      return;
    }

    const attempt = this.reconnectAttempts + 1;
    this.reconnectAttempts = attempt;
    const delay = explicitDelay ?? Math.min(30000, 3000 * attempt);

    this.clearReconnectTimer();
    this.log(`🔄 Scheduling reconnect (reason=${reason}) in ${delay}ms (attempt ${attempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.maybeConnect('reconnect');
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notifyState(state: ConnectionState): void {
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        this.log('⚠️ InboxSocket state listener failed', error);
      }
    });
  }

  private log(message: string, extra?: unknown): void {
    if (extra !== undefined) {
      console.log(`[InboxSocket] ${message}`, extra);
    } else {
      console.log(`[InboxSocket] ${message}`);
    }
  }
}

export const inboxSocketManager = new InboxSocketManager();
