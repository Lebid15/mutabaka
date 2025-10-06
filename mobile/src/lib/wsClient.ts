import { Platform } from 'react-native';
import { environment } from '../config/environment';

type QueryValue = string | number | boolean | null | undefined;

export interface CreateWebSocketOptions {
  token?: string | null;
  query?: Record<string, QueryValue>;
  protocols?: string | string[];
}

function appendQueryParameters(url: string, params?: Record<string, QueryValue>): string {
  if (!params || !Object.keys(params).length) {
    return url;
  }
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) {
    return url;
  }

  let suffix = '';
  if (typeof URLSearchParams !== 'undefined') {
    const searchParams = new URLSearchParams();
    entries.forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    suffix = searchParams.toString();
  } else {
    suffix = entries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }
  if (!suffix) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${suffix}`;
}

export function createWebSocket(baseUrl: string, options?: CreateWebSocketOptions): WebSocket {
  const { token, query, protocols } = options || {};
  const finalUrl = appendQueryParameters(baseUrl, {
    ...query,
    token: token ?? undefined,
  });

  console.log('[WebSocket] 🔌 Creating WebSocket connection...', {
    baseUrl,
    finalUrl: finalUrl.substring(0, 100) + '...',
    platform: Platform.OS,
    hasToken: !!token,
    tokenLength: token?.length || 0,
  });

  // Log FULL URL for debugging (only first 20 chars of token for security)
  const urlForDebug = token 
    ? finalUrl.replace(token, `${token.substring(0, 20)}...REDACTED`)
    : finalUrl;
  console.log('[WebSocket] 🔍 FULL URL (token redacted):', urlForDebug);

  if (Platform.OS === 'web') {
    return protocols ? new WebSocket(finalUrl, protocols) : new WebSocket(finalUrl);
  }

  const headers: Record<string, string> = {
    'X-Tenant-Host': environment.tenantHost,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const origin = environment.apiBaseUrl.replace(/\/api\/?$/u, '');
  if (origin) {
    headers.Origin = origin;
  }

  console.log('[WebSocket] 📤 Headers:', headers);
  console.log('[WebSocket] 🎯 Final URL:', finalUrl);

  const WebSocketImpl: any = WebSocket;
  const ws = protocols
    ? new WebSocketImpl(finalUrl, protocols, { headers })
    : new WebSocketImpl(finalUrl, undefined, { headers });

  // Add event listeners to debug connection issues
  ws.addEventListener('open', () => {
    console.log('[WebSocket] ✅ Connection OPENED successfully!', finalUrl.substring(0, 80));
    console.log('[WebSocket] 📊 ReadyState after open:', ws.readyState);
  });

  ws.addEventListener('error', (event: any) => {
    console.error('[WebSocket] ❌ Connection ERROR:', {
      type: event.type,
      message: event.message,
      url: finalUrl.substring(0, 80),
      readyState: ws.readyState,
      timestamp: new Date().toISOString(),
    });
  });

  ws.addEventListener('close', (event: any) => {
    console.warn('[WebSocket] 🔴 Connection CLOSED:', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      url: finalUrl.substring(0, 80),
      timestamp: new Date().toISOString(),
    });
  });

  // Monitor message sending
  const originalSend = ws.send.bind(ws);
  ws.send = function(data: any) {
    console.log('[WebSocket] 📤 Sending message:', {
      data: typeof data === 'string' ? data.substring(0, 100) : 'binary',
      readyState: ws.readyState,
      timestamp: new Date().toISOString(),
    });
    try {
      return originalSend(data);
    } catch (error) {
      console.error('[WebSocket] ❌ Send failed:', error);
      throw error;
    }
  };

  return ws;
}
