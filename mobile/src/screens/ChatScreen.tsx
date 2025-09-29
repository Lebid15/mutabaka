import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import ChatBubble from '../components/ChatBubble';
import { conversations, messages } from '../data/mock';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { HttpError } from '../lib/httpClient';
import { environment } from '../config/environment';
import { getAccessToken } from '../lib/authStorage';
import { fetchConversation, fetchNetBalance, type ConversationDto, type NetBalanceResponse } from '../services/conversations';
import { fetchMessages, sendMessage, type MessageDto } from '../services/messages';
import { fetchCurrencies, bootstrapCurrencies, type CurrencyDto } from '../services/currencies';
import { createTransaction } from '../services/transactions';
import { fetchCurrentUser, type CurrentUser } from '../services/user';
import { emitConversationPreviewUpdate } from '../lib/conversationEvents';
import { createWebSocket } from '../lib/wsClient';

interface BalanceSummary {
  code: string;
  symbol?: string | null;
  amount: number;
}

interface CurrencyOption {
  id: number;
  code: string;
  name: string;
  symbol?: string | null;
}

const ADMIN_USERNAMES = new Set(['admin', 'madmin', 'a_admin', 'l_admin']);

const EMOJI_PALETTE = ['😀','😂','😍','👍','🙏','🎉','💰','📌','❤️','😢','😎','🤔','✅','❌','🔥','🌟','🥰','😮','💡','📈','🤥','🌎'];

function isAdminLike(username?: string | null): boolean {
  if (!username) {
    return false;
  }
  return ADMIN_USERNAMES.has(username.toLowerCase());
}

function arabicToEnglishDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalizeNumberString(raw: string): string {
  const normalized = arabicToEnglishDigits(raw || '')
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, '')
    .replace(/,/g, '.')
    .trim();
  return normalized;
}

function parseNumericInput(raw: string): number {
  if (!raw) {
    return Number.NaN;
  }
  const normalized = normalizeNumberString(raw);
  if (!normalized) {
    return Number.NaN;
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return Number.NaN;
  }
  return Number(value.toFixed(5));
}

function formatBalance(amount: number): string {
  const absolute = Math.abs(amount);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absolute);
}

function computePairBalancesFromNet(net: NetBalanceResponse | null, viewerIsUserA: boolean): BalanceSummary[] {
  if (!net || !Array.isArray(net.net)) {
    return [];
  }

  return net.net
    .map((entry) => {
      const currencyMeta = entry?.currency as { code?: string; symbol?: string | null } | null | undefined;
      const code = currencyMeta?.code;
      if (!code) {
        return null;
      }

      const rawValue = entry?.net_from_user_a_perspective;
      const numericValue = typeof rawValue === 'number'
        ? rawValue
        : Number.parseFloat(String(rawValue ?? '0'));
      if (!Number.isFinite(numericValue)) {
        return null;
      }

      const amount = viewerIsUserA ? numericValue : numericValue * -1;
      const symbol = (currencyMeta as { symbol?: string | null } | null | undefined)?.symbol ?? null;
      return {
        code,
        symbol,
        amount,
      } as BalanceSummary;
    })
    .filter((item): item is BalanceSummary => Boolean(item));
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    const payload = error.payload as Record<string, unknown> | string | null | undefined;
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      const firstValue = Object.values(payload)[0];
      if (typeof firstValue === 'string') {
        return firstValue;
      }
      if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') {
        return firstValue[0];
      }
    }
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

interface NormalizedMessage {
  id: string;
  conversationId: string;
  author: 'me' | 'them';
  text: string;
  time: string;
  status: 'sent' | 'delivered' | 'read';
}

function getBalancePalette(currency: string, amount: number) {
  const positive = amount >= 0;
  if (positive) {
    if (currency === 'SYP') {
      return { backgroundColor: '#0f766e', textColor: '#fefce8' };
    }
    return { backgroundColor: '#047857', textColor: '#fefce8' };
  }
  return { backgroundColor: '#b91c1c', textColor: '#fee2e2' };
}

function formatMessageTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function mapDeliveryStatus(status?: number, fallback?: string | null): 'sent' | 'delivered' | 'read' {
  if (typeof status === 'number') {
    if (status >= 2) {
      return 'read';
    }
    if (status >= 1) {
      return 'delivered';
    }
  }
  if (fallback === 'read' || fallback === 'delivered' || fallback === 'sent') {
    return fallback;
  }
  return 'sent';
}

function resolveConversationPeer(conversation: ConversationDto, viewerId: number) {
  const isUserA = conversation.user_a.id === viewerId;
  return isUserA ? conversation.user_b : conversation.user_a;
}

export default function ChatScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const { mode, tokens } = useThemeMode();
  const conversationId = route.params?.conversationId;

  const [draft, setDraft] = useState('');
  const [showTransactionsOnly, setShowTransactionsOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [ourShare, setOurShare] = useState('');
  const [theirShare, setTheirShare] = useState('');
  const [note, setNote] = useState('');
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOption[]>([]);
  const [currencyPickerVisible, setCurrencyPickerVisible] = useState(false);
  const [pairBalances, setPairBalances] = useState<BalanceSummary[]>([]);
  const [remoteMessages, setRemoteMessages] = useState<MessageDto[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [remoteTitle, setRemoteTitle] = useState<string | null>(null);
  const [remoteAvatar, setRemoteAvatar] = useState<string | null>(null);
  const [peerUser, setPeerUser] = useState<ConversationDto['user_a'] | null>(null);
  const [conversationMeta, setConversationMeta] = useState<{ userAId: number; userBId: number } | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [balancesError, setBalancesError] = useState(false);
  const isMountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const pendingAckRef = useRef<Set<number>>(new Set());
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInboundMessageIdRef = useRef(0);
  const pendingReadRef = useRef<number | null>(null);
  const listRef = useRef<FlatList<NormalizedMessage> | null>(null);
  const initialScrollDoneRef = useRef(false);
  const initialScrollAttemptsRef = useRef(0);
  const initialScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, [conversationId]);

  const fallbackConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversationId],
  );

  const fallbackMessages = useMemo<NormalizedMessage[]>(
    () => messages
      .filter((m) => m.conversationId === conversationId)
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        author: m.author,
        text: m.text,
        time: m.time,
        status: m.status ?? 'sent',
      })),
    [conversationId],
  );

  const numericConversationId = Number(conversationId);
  const shouldUseBackend = !Number.isNaN(numericConversationId);
  const conversationWsUrl = useMemo(() => {
    if (!shouldUseBackend) {
      return null;
    }
    const base = environment.websocketBaseUrl.replace(/\/?$/, '/');
    return `${base}conversations/${numericConversationId}/`;
  }, [numericConversationId, shouldUseBackend]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    initialScrollAttemptsRef.current = 0;
    if (initialScrollTimerRef.current) {
      clearTimeout(initialScrollTimerRef.current);
      initialScrollTimerRef.current = null;
    }
    setEmojiPickerVisible(false);
  }, [conversationId]);

  const scrollToBottom = useCallback((animated = false, onSuccess?: () => void): boolean => {
    const list = listRef.current;
    if (list) {
      try {
        list.scrollToEnd({ animated });
        onSuccess?.();
        return true;
      } catch (error) {
        console.warn('[Mutabaka] Failed to scroll to bottom', error);
      }
    }

    InteractionManager.runAfterInteractions(() => {
      const listAfter = listRef.current;
      if (!listAfter) {
        return;
      }
      try {
        listAfter.scrollToEnd({ animated });
        onSuccess?.();
      } catch (error) {
        console.warn('[Mutabaka] (retry) Failed to scroll to bottom', error);
      }
    });

    return Boolean(list);
  }, []);

  const clearInitialScrollTimer = useCallback(() => {
    if (initialScrollTimerRef.current) {
      clearTimeout(initialScrollTimerRef.current);
      initialScrollTimerRef.current = null;
    }
  }, []);

  const flushAck = useCallback(() => {
    if (!pendingAckRef.current.size) {
      return;
    }
    const ids = Array.from(pendingAckRef.current);
    const batch = ids.slice(0, 300);
    batch.forEach((id) => pendingAckRef.current.delete(id));
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'ack', message_ids: batch }));
      } catch (error) {
        console.warn('[Mutabaka] Failed to send ACK batch', error);
        batch.forEach((id) => pendingAckRef.current.add(id));
      }
    } else {
      batch.forEach((id) => pendingAckRef.current.add(id));
    }
    if (pendingAckRef.current.size > 0 && !ackTimerRef.current) {
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        flushAck();
      }, 180);
    }
  }, []);

  const queueAck = useCallback((messageId: number) => {
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return;
    }
    pendingAckRef.current.add(messageId);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      flushAck();
    } else if (!ackTimerRef.current) {
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        flushAck();
      }, 200);
    }
  }, [flushAck]);

  const flushPendingRead = useCallback(() => {
    const socket = wsRef.current;
    const lastId = pendingReadRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !lastId || lastId <= 0) {
      return;
    }
    try {
      socket.send(JSON.stringify({ type: 'read', last_read_id: lastId }));
      pendingReadRef.current = null;
    } catch (error) {
      console.warn('[Mutabaka] Failed to send READ event', error);
    }
  }, []);

  const queueRead = useCallback((messageId: number) => {
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return;
    }
    const pending = pendingReadRef.current ?? 0;
    if (messageId > pending) {
      pendingReadRef.current = messageId;
    }
    flushPendingRead();
  }, [flushPendingRead]);

  const refreshNetBalance = useCallback(async () => {
    if (!shouldUseBackend || !Number.isFinite(numericConversationId) || !currentUser || !conversationMeta) {
      return;
    }

    try {
      const response = await fetchNetBalance(numericConversationId);
      if (!isMountedRef.current) {
        return;
      }

      const viewerIsUserA = currentUser.id === conversationMeta.userAId;
      const computed = computePairBalancesFromNet(response, viewerIsUserA);
      setPairBalances(computed);
      setBalancesError(false);
    } catch (error) {
      console.warn('[Mutabaka] Failed to refresh net balance', error);
    }
  }, [conversationMeta, currentUser, numericConversationId, shouldUseBackend]);

  const handleWsMessage = useCallback((payload: any) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'chat.message') {
      const rawId = typeof payload.id === 'number' ? payload.id : Number(payload.id);
      const messageId = Number.isFinite(rawId) ? rawId : Date.now();
      const createdAt = typeof payload.created_at === 'string' && payload.created_at
        ? payload.created_at
        : new Date().toISOString();
      const deliveryStatus = typeof payload.delivery_status === 'number'
        ? payload.delivery_status
        : payload.status === 'read'
          ? 2
          : payload.status === 'delivered'
            ? 1
            : 0;
      const messageStatus: MessageDto['status'] = deliveryStatus >= 2 ? 'read' : deliveryStatus >= 1 ? 'delivered' : 'sent';
      const senderUsername = typeof payload.sender === 'string' ? payload.sender : '';
      const meUsername = currentUser?.username?.toLowerCase() ?? '';
      const isMine = senderUsername && meUsername && senderUsername.toLowerCase() === meUsername;

      const senderDisplay = typeof payload.senderDisplay === 'string' && payload.senderDisplay.trim()
        ? payload.senderDisplay
        : isMine
          ? currentUser?.display_name || currentUser?.username || 'أنا'
          : peerUser?.display_name || peerUser?.username || senderUsername || 'مستخدم';

      const senderInfo = isMine
        ? currentUser
          ? {
              id: currentUser.id,
              username: currentUser.username,
              display_name: currentUser.display_name,
            }
          : undefined
        : peerUser
        ? {
            id: peerUser.id,
            username: peerUser.username,
            display_name: peerUser.display_name,
          }
        : { id: -1, username: senderUsername || 'unknown' };

      const nextMessage: MessageDto = {
        id: messageId,
        conversation: numericConversationId,
        sender: senderInfo,
        senderType: 'user',
        senderDisplay,
        type: typeof payload.kind === 'string' ? payload.kind : 'text',
        body: typeof payload.body === 'string' ? payload.body : '',
        created_at: createdAt,
        status: messageStatus,
        delivery_status: deliveryStatus,
        delivered_at: typeof payload.delivered_at === 'string' ? payload.delivered_at : undefined,
        read_at: typeof payload.read_at === 'string' ? payload.read_at : undefined,
      };

      setRemoteMessages((prev) => {
        let updated = false;
        const mapped = prev.map((msg) => {
          if (msg.id !== nextMessage.id) {
            return msg;
          }
          updated = true;
          return {
            ...msg,
            ...nextMessage,
            sender: msg.sender ?? nextMessage.sender,
            senderDisplay: nextMessage.senderDisplay || msg.senderDisplay,
            status: nextMessage.status ?? msg.status,
            delivery_status: nextMessage.delivery_status ?? msg.delivery_status ?? 0,
            delivered_at: nextMessage.delivered_at ?? msg.delivered_at,
            read_at: nextMessage.read_at ?? msg.read_at,
          };
        });

        if (Number.isFinite(numericConversationId)) {
          const preview = typeof payload.preview === 'string' && payload.preview.trim()
            ? payload.preview
            : typeof nextMessage.body === 'string' && nextMessage.body.trim()
              ? nextMessage.body
              : 'رسالة جديدة';
          emitConversationPreviewUpdate({
            id: numericConversationId,
            lastMessageAt: nextMessage.created_at,
            lastActivityAt: nextMessage.created_at,
            lastMessagePreview: preview,
            unreadCount: isMine ? undefined : 0,
          });
        }
        if (!updated) {
          mapped.push(nextMessage);
        }

        mapped.sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
            return aTime - bTime;
          }
          return a.id - b.id;
        });

        return mapped;
      });

      if (nextMessage.type === 'transaction') {
        refreshNetBalance();
      }

      if (!isMine && Number.isFinite(messageId)) {
        lastInboundMessageIdRef.current = Math.max(lastInboundMessageIdRef.current, messageId);
        queueAck(messageId);
        queueRead(messageId);
      }

      return;
    }

    if (payload.type === 'message.status') {
      const rawId = typeof payload.id === 'number' ? payload.id : Number(payload.id || payload.message_id);
      if (!Number.isFinite(rawId) || rawId <= 0) {
        return;
      }
      const deliveryStatus = typeof payload.delivery_status === 'number'
        ? payload.delivery_status
        : payload.status === 'read'
          ? 2
          : payload.status === 'delivered'
            ? 1
            : undefined;
      const readAt = typeof payload.read_at === 'string' && payload.read_at ? payload.read_at : undefined;
      const deliveredAt = typeof payload.delivered_at === 'string' && payload.delivered_at ? payload.delivered_at : undefined;

      setRemoteMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== rawId) {
            return msg;
          }
          const nextDelivery = deliveryStatus !== undefined
            ? Math.max(msg.delivery_status ?? 0, deliveryStatus)
            : msg.delivery_status ?? 0;
          const nextStatus: MessageDto['status'] = nextDelivery >= 2 ? 'read' : nextDelivery >= 1 ? 'delivered' : msg.status ?? 'sent';
          return {
            ...msg,
            delivery_status: nextDelivery,
            status: nextStatus,
            read_at: readAt ?? msg.read_at ?? (nextStatus === 'read' ? msg.read_at ?? new Date().toISOString() : msg.read_at),
            delivered_at: deliveredAt ?? msg.delivered_at ?? (nextDelivery >= 1 ? (msg.delivered_at ?? msg.created_at) : msg.delivered_at),
          };
        }),
      );
      return;
    }

    if (payload.type === 'chat.read') {
      const reader = typeof payload.reader === 'string' ? payload.reader : '';
      const meUsername = currentUser?.username?.toLowerCase() ?? '';
      if (reader && reader.toLowerCase() === meUsername) {
        return;
      }
      const lastReadId = Number(payload.last_read_id);
      if (!Number.isFinite(lastReadId) || lastReadId <= 0 || !currentUser) {
        return;
      }
      setRemoteMessages((prev) =>
        prev.map((msg) => {
          const isMineMessage =
            (msg.sender?.id === currentUser.id) ||
            (msg.sender?.username && msg.sender.username === currentUser.username) ||
            msg.senderDisplay === currentUser.username ||
            (!!currentUser.display_name && msg.senderDisplay === currentUser.display_name);
          if (isMineMessage && msg.id <= lastReadId) {
            return {
              ...msg,
              delivery_status: 2,
              status: 'read',
              read_at: msg.read_at ?? new Date().toISOString(),
            };
          }
          return msg;
        }),
      );
    }
  }, [currentUser, peerUser, numericConversationId, queueAck, queueRead, refreshNetBalance]);

  const loadCurrencyOptions = useCallback(async () => {
    try {
      let list = await fetchCurrencies();
      if (!list.length) {
        try {
          await bootstrapCurrencies();
          list = await fetchCurrencies();
        } catch (error) {
          console.warn('[Mutabaka] bootstrapCurrencies failed', error);
        }
      }
      if (list.length) {
        setCurrencyOptions(list);
        if (!list.some((item) => item.code === selectedCurrency)) {
          setSelectedCurrency(list[0].code);
        }
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to load currencies', error);
    }
  }, [selectedCurrency]);

  const loadConversationData = useCallback(async () => {
    if (!shouldUseBackend) {
      setRemoteMessages([]);
      setRemoteTitle(null);
      setRemoteAvatar(null);
      setCurrentUser(null);
      setConversationMeta(null);
      setErrorMessage(null);
      setLoadingMessages(false);
      pendingAckRef.current.clear();
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
      pendingReadRef.current = null;
      lastInboundMessageIdRef.current = 0;
      setPairBalances([]);
      setBalancesError(false);
      return;
    }

    try {
      setLoadingMessages(true);
      setErrorMessage(null);
      setBalancesError(false);
      let netBalanceErrored = false;
      const [me, conversationData, messagesResponse, netBalance] = await Promise.all([
        fetchCurrentUser(),
        fetchConversation(numericConversationId),
        fetchMessages(numericConversationId),
        fetchNetBalance(numericConversationId).catch((error) => {
          console.warn('[Mutabaka] Failed to fetch net balance', error);
          netBalanceErrored = true;
          return null as NetBalanceResponse | null;
        }),
      ]);

      if (!isMountedRef.current) {
        return;
      }

      setCurrentUser(me);
      const peer = resolveConversationPeer(conversationData, me.id);
      setRemoteTitle(peer.display_name || peer.username);
      setRemoteAvatar(peer.logo_url || null);
      setPeerUser(peer);
      setConversationMeta({ userAId: conversationData.user_a.id, userBId: conversationData.user_b.id });
      const sortedMessages = (messagesResponse.results || [])
        .filter((msg) => msg.conversation === numericConversationId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      setRemoteMessages(sortedMessages);
      if (sortedMessages.length) {
        const inboundMax = sortedMessages.reduce((max, msg) => {
          if (msg.sender?.id && msg.sender.id !== me.id) {
            return Math.max(max, msg.id);
          }
          return max;
        }, 0);
        if (inboundMax > 0) {
          lastInboundMessageIdRef.current = inboundMax;
          queueRead(inboundMax);
        } else {
          lastInboundMessageIdRef.current = 0;
          pendingReadRef.current = null;
        }
      } else {
        lastInboundMessageIdRef.current = 0;
        pendingReadRef.current = null;
      }
      if (Number.isFinite(numericConversationId)) {
        emitConversationPreviewUpdate({
          id: numericConversationId,
          unreadCount: 0,
        });
      }
      if (netBalance) {
        const viewerIsUserA = conversationData.user_a.id === me.id;
        const computed = computePairBalancesFromNet(netBalance, viewerIsUserA);
        setPairBalances(computed);
        setBalancesError(false);
      } else if (netBalanceErrored) {
        setBalancesError(true);
      } else {
        setPairBalances([]);
        setBalancesError(false);
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
  console.warn('[Mutabaka] Failed to load conversation messages', error);
  setErrorMessage('تعذر تحميل الرسائل. تحقق من الاتصال بالخادم.');
      setBalancesError(true);
    } finally {
      if (isMountedRef.current) {
        setLoadingMessages(false);
      }
    }
  }, [numericConversationId, queueRead, shouldUseBackend]);

  useFocusEffect(
    useCallback(() => {
      loadConversationData();
      let focusTimer: ReturnType<typeof setTimeout> | null = null;
      if (Number.isFinite(numericConversationId)) {
        focusTimer = setTimeout(() => {
          emitConversationPreviewUpdate({ id: numericConversationId, unreadCount: 0 });
        }, 0);
      }

      return () => {
        if (focusTimer) {
          clearTimeout(focusTimer);
          focusTimer = null;
        }
        if (Number.isFinite(numericConversationId)) {
          setTimeout(() => {
            emitConversationPreviewUpdate({ id: numericConversationId, unreadCount: 0 });
          }, 0);
        }
      };
    }, [loadConversationData, numericConversationId]),
  );

  useEffect(() => {
    loadCurrencyOptions();
  }, [loadCurrencyOptions]);

  useEffect(() => {
    if (!conversationWsUrl || !currentUser) {
      return;
    }

    let cancelled = false;
    let manuallyClosed = false;
    const wsUrl = conversationWsUrl as string;

    function scheduleRetry() {
      if (cancelled || manuallyClosed) {
        return;
      }
      const attempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempt;
      if (attempt > 8) {
        return;
      }
      const delay = Math.min(1000 * Math.pow(1.8, attempt - 1), 8000);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    async function connect() {
      if (cancelled) {
        return;
      }
      let token: string | null = null;
      try {
        token = await getAccessToken();
      } catch (error) {
        console.warn('[Mutabaka] Failed to read auth token for chat socket', error);
      }
      let socket: WebSocket | null = null;
      try {
        socket = createWebSocket(wsUrl, {
          token,
          query: {
            tenant: environment.tenantHost,
            tenant_host: environment.tenantHost,
          },
        });
      } catch (error) {
        console.warn('[Mutabaka] Failed to open chat socket', error);
        scheduleRetry();
        return;
      }
      wsRef.current = socket;
      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        console.log('[Mutabaka] Chat socket opened');
        flushAck();
        flushPendingRead();
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleWsMessage(payload);
        } catch (error) {
          console.warn('[Mutabaka] Failed to parse chat socket payload', error);
        }
      };
      socket.onerror = (error) => {
        console.warn('[Mutabaka] Chat socket error event', error);
        try {
          socket?.close();
        } catch {}
      };
      socket.onclose = (event) => {
        console.warn('[Mutabaka] Chat socket closed', { code: event.code, reason: event.reason });
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (!cancelled && !manuallyClosed && event.code !== 1000) {
          scheduleRetry();
        }
      };
    }

    reconnectAttemptsRef.current = 0;
    connect();

    return () => {
      cancelled = true;
      manuallyClosed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
      pendingAckRef.current.clear();
    };
  }, [conversationWsUrl, currentUser, flushAck, flushPendingRead, handleWsMessage]);

  const conversationMessages = useMemo<NormalizedMessage[]>(() => {
    if (remoteMessages.length && currentUser) {
      return remoteMessages.map((msg) => ({
        id: String(msg.id),
        conversationId: String(msg.conversation),
        author: msg.sender?.id === currentUser.id ? 'me' : 'them',
        text: msg.body,
        time: formatMessageTime(msg.created_at),
        status: mapDeliveryStatus(msg.delivery_status, msg.status),
      }));
    }
    return fallbackMessages;
  }, [currentUser, remoteMessages, fallbackMessages]);

  const headerTitle = remoteTitle ?? fallbackConversation?.title ?? 'محادثة';

  const filteredMessages = useMemo<NormalizedMessage[]>(() => {
    let next = [...conversationMessages];
    if (showTransactionsOnly) {
      next = next.filter((msg) => /تحويل|دفعة|اشتراك|فاتورة/i.test(msg.text));
    }
    if (searchQuery.trim()) {
      const needle = searchQuery.trim();
      next = next.filter((msg) => msg.text.includes(needle));
    }
    return next;
  }, [conversationMessages, showTransactionsOnly, searchQuery]);

  const requestInitialScroll = useCallback(
    (animated = false) => {
      if (!filteredMessages.length || initialScrollDoneRef.current) {
        return;
      }

      const markDone = () => {
        initialScrollDoneRef.current = true;
        initialScrollAttemptsRef.current = 0;
        clearInitialScrollTimer();
      };

      const success = scrollToBottom(animated, markDone);
      if (success) {
        markDone();
        return;
      }

      if (initialScrollAttemptsRef.current >= 6) {
        return;
      }

      initialScrollAttemptsRef.current += 1;
      clearInitialScrollTimer();
      initialScrollTimerRef.current = setTimeout(() => {
        requestInitialScroll(animated);
      }, 200);
    },
    [clearInitialScrollTimer, filteredMessages.length, scrollToBottom],
  );

  useEffect(() => () => {
    clearInitialScrollTimer();
  }, [clearInitialScrollTimer]);

  const handleListContentSizeChange = useCallback(() => {
    requestInitialScroll(false);
  }, [requestInitialScroll]);

  useFocusEffect(
    useCallback(() => {
      initialScrollDoneRef.current = false;
      initialScrollAttemptsRef.current = 0;
      requestInitialScroll(false);

      return () => {
        clearInitialScrollTimer();
      };
    }, [clearInitialScrollTimer, requestInitialScroll]),
  );

  useEffect(() => {
    if (!filteredMessages.length) {
      clearInitialScrollTimer();
      return;
    }
    if (initialScrollDoneRef.current) {
      return;
    }
    initialScrollAttemptsRef.current = 0;
    requestInitialScroll(false);
    return () => {
      clearInitialScrollTimer();
    };
  }, [clearInitialScrollTimer, filteredMessages.length, requestInitialScroll]);

  useEffect(() => {
    if (composerHeight <= 0) {
      return;
    }
    if (initialScrollDoneRef.current) {
      scrollToBottom(false);
    } else {
      requestInitialScroll(false);
    }
  }, [composerHeight, requestInitialScroll, scrollToBottom]);

  const lastMessageKey = useMemo(() => {
    if (!filteredMessages.length) {
      return null;
    }
    const last = filteredMessages[filteredMessages.length - 1];
    return `${last.id}-${last.time}`;
  }, [filteredMessages]);

  useEffect(() => {
    if (!initialScrollDoneRef.current) {
      return;
    }
    if (!lastMessageKey) {
      return;
    }
    const timer = setTimeout(() => {
      scrollToBottom(true);
    }, 120);
    return () => {
      clearTimeout(timer);
    };
  }, [lastMessageKey, scrollToBottom]);

  const currencyMap = useMemo(() => {
    const map = new Map<string, CurrencyOption>();
    currencyOptions.forEach((option) => {
      map.set(option.code, option);
    });
    return map;
  }, [currencyOptions]);

  const selectedCurrencyOption = useMemo(() => currencyMap.get(selectedCurrency), [currencyMap, selectedCurrency]);

  const handleInsertEmoji = useCallback((emoji: string) => {
    if (!emoji) {
      return;
    }
    setDraft((prev) => {
      const next = prev ?? '';
      const needsSpace = next.length > 0 && !/\s$/.test(next);
      return `${next}${needsSpace ? ' ' : ''}${emoji}`;
    });
    setEmojiPickerVisible(false);
  }, [setEmojiPickerVisible]);

  const handleSaveTransaction = useCallback(async () => {
    if (!shouldUseBackend || Number.isNaN(numericConversationId) || transactionLoading) {
      return;
    }

    const parsedOurs = parseNumericInput(ourShare);
    const parsedTheirs = parseNumericInput(theirShare);
    const operations: { amount: number; direction: 'lna' | 'lkm' }[] = [];
    if (!Number.isNaN(parsedOurs)) {
      operations.push({ amount: parsedOurs, direction: 'lna' });
    }
    if (!Number.isNaN(parsedTheirs)) {
      operations.push({ amount: parsedTheirs, direction: 'lkm' });
    }

    if (!operations.length) {
      Alert.alert('القيمة غير صالحة', 'الرجاء إدخال قيمة موجبة في أحد الحقول قبل الحفظ.');
      return;
    }

    let currencyId = selectedCurrencyOption?.id;
    if (!currencyId) {
      try {
        let latest = await fetchCurrencies();
        if (!latest.length) {
          try {
            await bootstrapCurrencies();
            latest = await fetchCurrencies();
          } catch (error) {
            console.warn('[Mutabaka] bootstrapCurrencies retry failed', error);
          }
        }
        setCurrencyOptions(latest);
        currencyId = latest.find((item) => item.code === selectedCurrency)?.id;
      } catch (error) {
        console.warn('[Mutabaka] Failed to refresh currencies', error);
      }
    }

    if (!currencyId) {
      Alert.alert('لم يتم العثور على العملة', 'تعذر تحديد العملة المختارة. حاول اختيار عملة أخرى أو إعادة تحميل الصفحة.');
      return;
    }

    setTransactionLoading(true);
    setStatusBanner(null);

    try {
      for (const op of operations) {
        await createTransaction({
          conversation: numericConversationId,
          currency_id: currencyId,
          amount: op.amount.toFixed(5),
          direction: op.direction,
          note: note.trim() || undefined,
        });
      }

      setStatusBanner({ kind: 'success', text: 'تم حفظ المعاملة' });
      setOurShare('');
      setTheirShare('');
      setNote('');
      setNoteModalVisible(false);
      await loadConversationData();
    } catch (error) {
      const message = extractErrorMessage(error, 'فشل حفظ المعاملة');
      setStatusBanner({ kind: 'error', text: message });
      Alert.alert('فشل حفظ المعاملة', message);
    } finally {
      if (isMountedRef.current) {
        setTransactionLoading(false);
      }
    }
  }, [loadConversationData, note, numericConversationId, ourShare, selectedCurrency, selectedCurrencyOption, shouldUseBackend, theirShare, transactionLoading]);

  const isLight = mode === 'light';

  const headerBackground = isLight ? '#fff3e4' : tokens.panel;
  const headerBorderColor = tokens.divider;
  const headerButtonBackground = isLight ? '#fff9f2' : tokens.panelAlt;
  const headerButtonBorder = isLight ? '#f4d7c0' : tokens.divider;
  const headerPrimaryText = isLight ? '#2d241a' : '#ffffff';
  const headerSecondaryText = isLight ? '#8c6d52' : '#94a3b8';
  const headerIconColor = isLight ? '#f97316' : '#facc15';

  const filterActiveBackground = isLight ? '#dcfce7' : '#14532d';
  const filterActiveBorder = isLight ? '#4ade80' : '#22c55e';
  const filterActiveIcon = isLight ? '#047857' : '#bbf7d0';

  const searchActiveBackground = isLight ? '#fde4c3' : '#1f2937';
  const searchActiveBorder = isLight ? '#f9d3a7' : '#334155';
  const searchActiveIcon = isLight ? '#b45309' : '#facc15';

  const composerBackground = isLight ? '#fff6ec' : tokens.panel;
  const composerButtonBackground = isLight ? '#fffaf4' : tokens.panelAlt;
  const composerButtonBorder = headerButtonBorder;
  const composerInputBackground = isLight ? '#ffffff' : tokens.panelAlt;
  const composerInputBorder = isLight ? '#f4d3b5' : tokens.divider;
  const composerPlaceholderColor = isLight ? '#7c2d12' : '#facc15';

  const composerLineHeight = 20;
  const composerMaxLines = 4;
  const composerWrapperVerticalPadding = 20;
  const composerMinContentHeight = 32;
  const composerMaxContentHeight = composerLineHeight * composerMaxLines;
  const composerMinWrapperHeight = composerMinContentHeight + composerWrapperVerticalPadding;
  const composerMaxWrapperHeight = composerMaxContentHeight + composerWrapperVerticalPadding;
  const [composerContentHeight, setComposerContentHeight] = useState(composerMinContentHeight);

  const handleComposerContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const height = event?.nativeEvent?.contentSize?.height;
      if (!Number.isFinite(height)) {
        return;
      }
      const clamped = Math.min(
        composerMaxContentHeight,
        Math.max(composerMinContentHeight, height),
      );
      setComposerContentHeight((prev) => (Math.abs(prev - clamped) < 1 ? prev : clamped));
    },
    [composerMaxContentHeight, composerMinContentHeight],
  );

  useEffect(() => {
    if (!draft) {
      setComposerContentHeight(composerMinContentHeight);
    }
  }, [draft, composerMinContentHeight]);

  const composerWrapperHeight = Math.min(
    composerMaxWrapperHeight,
    Math.max(composerMinWrapperHeight, composerContentHeight + composerWrapperVerticalPadding),
  );
  const composerReachedMaxLines = composerContentHeight >= composerMaxContentHeight - 1;

  const actionBaseStyle = useMemo(
    () => ({ backgroundColor: headerButtonBackground, borderColor: headerButtonBorder }),
    [headerButtonBackground, headerButtonBorder],
  );

  const balances = useMemo(() => {
    if (!pairBalances.length) {
      return [] as BalanceSummary[];
    }
    const priority = ['USD', 'TRY', 'EUR', 'SYP'];
    const map = new Map<string, BalanceSummary>();
    pairBalances.forEach((balance) => {
      map.set(balance.code, balance);
    });
    const ordered = priority
      .map((code) => map.get(code))
      .filter((item): item is BalanceSummary => Boolean(item));
    const remaining = pairBalances.filter((balance) => !priority.includes(balance.code));
    return [...ordered, ...remaining].filter((balance) => Math.abs(balance.amount) >= 0.005);
  }, [pairBalances]);

  const renderBalanceChip = useCallback((balance: BalanceSummary) => {
    const positive = balance.amount >= 0;
    const textColor = positive ? '#047857' : '#b91c1c';
    const symbol = currencyMap.get(balance.code)?.symbol || balance.symbol || balance.code;
    const formatted = `${positive ? '' : '-'}${formatBalance(balance.amount)}`;

    return (
      <View key={balance.code} style={styles.balanceChip}>
        <Text style={[styles.balanceText, { color: textColor }]} numberOfLines={1}>
          {formatted}
          <Text style={[styles.balanceCurrency, { color: textColor }]}> {symbol}</Text>
        </Text>
      </View>
    );
  }, [currencyMap]);

  const hideFinancialTools = useMemo(() => (
    isAdminLike(currentUser?.username) || isAdminLike(peerUser?.username)
  ), [currentUser?.username, peerUser?.username]);

  const showBalancesRow = useMemo(() => (
    !hideFinancialTools && (balances.length > 0 || balancesError)
  ), [balances.length, balancesError, hideFinancialTools]);

  const renderEmpty = useCallback(() => {
    if (shouldUseBackend && loadingMessages) {
      return (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: tokens.textMuted }]}>جارٍ تحميل الرسائل…</Text>
        </View>
      );
    }
    const message = showTransactionsOnly
      ? 'لا توجد معاملات محفوظة بعد في هذه المحادثة.'
      : 'ابدأ المحادثة بكتابة رسالة في الأسفل.';

    return (
      <View style={styles.emptyState}>
        <Text style={[styles.emptyText, { color: tokens.textMuted }]}>{message}</Text>
      </View>
    );
  }, [loadingMessages, shouldUseBackend, showTransactionsOnly, tokens.textMuted]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }

    if (!shouldUseBackend || Number.isNaN(numericConversationId)) {
      const optimistic: MessageDto = {
        id: Number.NEGATIVE_INFINITY,
        conversation: numericConversationId,
        sender: currentUser ? {
          id: currentUser.id,
          username: currentUser.username,
          display_name: currentUser.display_name,
        } : undefined,
        senderType: 'user',
        senderDisplay: currentUser?.display_name || currentUser?.username || 'أنا',
        type: 'text',
        body: text,
        created_at: new Date().toISOString(),
        status: 'sent',
        delivery_status: 0,
      };
      setRemoteMessages((prev) => [...prev, optimistic]);
      setDraft('');
      if (Number.isFinite(numericConversationId)) {
        const previewText = optimistic.body && optimistic.body.trim().length ? optimistic.body : 'رسالة جديدة';
        emitConversationPreviewUpdate({
          id: numericConversationId,
          lastMessageAt: optimistic.created_at,
          lastActivityAt: optimistic.created_at,
          lastMessagePreview: previewText,
          unreadCount: 0,
        });
      }
      return;
    }

    const optimisticId = -Math.floor(Date.now() + Math.random() * 1000);
    const optimisticMessage: MessageDto = {
      id: optimisticId,
      conversation: numericConversationId,
      sender: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        display_name: currentUser.display_name,
      } : undefined,
      senderType: 'user',
      senderDisplay: currentUser?.display_name || currentUser?.username || 'أنا',
      type: 'text',
      body: text,
      created_at: new Date().toISOString(),
      status: 'sent',
      delivery_status: 0,
    };

    setRemoteMessages((prev) => [...prev, optimisticMessage]);
    setDraft('');
    setSendingMessage(true);
    setStatusBanner(null);

    const optimisticPreview = optimisticMessage.body && optimisticMessage.body.trim().length
      ? optimisticMessage.body
      : 'رسالة جديدة';

    emitConversationPreviewUpdate({
      id: numericConversationId,
      lastMessageAt: optimisticMessage.created_at,
      lastActivityAt: optimisticMessage.created_at,
      lastMessagePreview: optimisticPreview,
      unreadCount: 0,
    });

    try {
      const response = await sendMessage(numericConversationId, text);
      setRemoteMessages((prev) => {
        const filtered = prev.filter((msg) => msg.id !== optimisticId);
        const withoutDuplicate = filtered.filter((msg) => msg.id !== response.id);
        const next = [...withoutDuplicate, response];
        return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });

      const responsePreview = typeof response.body === 'string' && response.body.trim().length
        ? response.body
        : optimisticPreview;
      emitConversationPreviewUpdate({
        id: numericConversationId,
        lastMessageAt: response.created_at,
        lastActivityAt: response.created_at,
        lastMessagePreview: responsePreview,
        unreadCount: 0,
      });
    } catch (error) {
      setRemoteMessages((prev) => prev.filter((msg) => msg.id !== optimisticId));
      setDraft(text);
      const message = extractErrorMessage(error, 'تعذر إرسال الرسالة');
      if (error instanceof HttpError && error.status === 403 && (error.payload as any)?.otp_required) {
        Alert.alert('رمز التحقق مطلوب', 'الرجاء إدخال رمز OTP من تطبيق المصادقة ثم إعادة المحاولة.');
      } else {
        Alert.alert('تعذر إرسال الرسالة', message);
      }
    } finally {
      if (isMountedRef.current) {
        setSendingMessage(false);
      }
    }
  }, [currentUser, draft, numericConversationId, shouldUseBackend]);

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <View style={[styles.screen, { backgroundColor: tokens.background }]}> 
            <View
              style={[styles.headerContainer, { backgroundColor: headerBackground, borderColor: headerBorderColor }]}
            >
              <View style={styles.headerRow}>
                <Pressable
                  onPress={() => navigation.goBack()}
                  accessibilityLabel="رجوع"
                  style={[styles.headerButton, actionBaseStyle]}
                >
                  <FeatherIcon name="arrow-right" size={18} color={headerIconColor} />
                </Pressable>
                <View style={styles.contactInfo}>
                  <View style={[styles.avatar, actionBaseStyle]}>
                    {remoteAvatar ? (
                      <Image source={{ uri: remoteAvatar }} style={styles.avatarImage} />
                    ) : (
                      <FeatherIcon name="user" size={20} color={headerIconColor} />
                    )}
                  </View>
                  <Text
                    style={[styles.contactName, { color: headerPrimaryText }]}
                    numberOfLines={1}
                  >
                    {headerTitle}
                  </Text>
                </View>
                <View style={styles.actionsRow}>
                  <Pressable
                    accessibilityLabel="فلترة المعاملات"
                    onPress={() => setShowTransactionsOnly((prev) => !prev)}
                    style={[
                      styles.actionButton,
                      actionBaseStyle,
                      showTransactionsOnly && {
                        backgroundColor: filterActiveBackground,
                        borderColor: filterActiveBorder,
                      },
                    ]}
                  >
                    <FeatherIcon
                      name="sliders"
                      size={18}
                      color={showTransactionsOnly ? filterActiveIcon : headerIconColor}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="أعضاء المحادثة"
                    style={[styles.actionButton, actionBaseStyle]}
                  >
                    <FeatherIcon name="users" size={18} color={headerIconColor} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="بحث داخل المحادثة"
                    onPress={() => setSearchOpen((prev) => !prev)}
                    style={[
                      styles.actionButton,
                      actionBaseStyle,
                      searchOpen && {
                        backgroundColor: searchActiveBackground,
                        borderColor: searchActiveBorder,
                      },
                    ]}
                  >
                    <FeatherIcon
                      name="search"
                      size={18}
                      color={searchOpen ? searchActiveIcon : headerIconColor}
                    />
                  </Pressable>
                </View>
              </View>

              {searchOpen ? (
                <View
                  style={[styles.searchBar, { backgroundColor: headerButtonBackground, borderColor: headerButtonBorder }]}
                >
                  <FeatherIcon name="search" size={16} color={headerIconColor} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="ابحث داخل هذه المحادثة"
                    placeholderTextColor={headerSecondaryText}
                    style={[styles.searchInput, { color: headerPrimaryText }]}
                    textAlign="right"
                  />
                </View>
              ) : null}

              {showBalancesRow ? (
                <View style={styles.balanceRow}>
                  {balances.length > 0 ? (
                    balances.map(renderBalanceChip)
                  ) : (
                    <View style={[styles.balanceChip, styles.balancePlaceholder]}>
                      <Text style={styles.balancePlaceholderText}>الرصيد غير متاح حالياً</Text>
                    </View>
                  )}
                </View>
              ) : null}
            </View>

            {errorMessage ? (
              <View style={[styles.errorBanner, { backgroundColor: isLight ? '#fee2e2' : '#7f1d1d' }]}
              >
                <Text style={{ color: isLight ? '#991b1b' : '#fecdd3', fontSize: 12, textAlign: 'center', fontWeight: '600' }}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            <FlatList<NormalizedMessage>
              ref={listRef}
              data={filteredMessages}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(composerHeight + 24, 80) }]}
              onContentSizeChange={handleListContentSizeChange}
              ListEmptyComponent={renderEmpty}
              refreshing={shouldUseBackend ? loadingMessages : false}
              onRefresh={loadConversationData}
              ListFooterComponent={<View style={styles.listFooterSpacer} />}
              renderItem={({ item }) => (
                <ChatBubble
                  message={item.text}
                  time={item.time}
                  isMine={item.author === 'me'}
                  status={item.status}
                />
              )}
            />

            <View
              style={[styles.composer, { backgroundColor: composerBackground, borderColor: tokens.divider }]}
              onLayout={(event) => {
                const height = event?.nativeEvent?.layout?.height;
                if (!Number.isFinite(height)) {
                  return;
                }
                setComposerHeight((prev) => (Math.abs(prev - height) > 0.5 ? height : prev));
              }}
            > 
              {statusBanner ? (
                <View
                  style={[
                    styles.statusBanner,
                    statusBanner.kind === 'success'
                      ? { backgroundColor: isLight ? '#dcfce7' : '#14532d', borderColor: isLight ? '#34d399' : '#22c55e' }
                      : { backgroundColor: isLight ? '#fee2e2' : '#7f1d1d', borderColor: isLight ? '#f87171' : '#fda4af' },
                  ]}
                >
                  <FeatherIcon
                    name={statusBanner.kind === 'success' ? 'check-circle' : 'alert-circle'}
                    size={16}
                    color={statusBanner.kind === 'success' ? (isLight ? '#166534' : '#bbf7d0') : (isLight ? '#b91c1c' : '#fecdd3')}
                  />
                  <Text
                    style={[
                      styles.statusBannerText,
                      { color: statusBanner.kind === 'success' ? (isLight ? '#166534' : '#bbf7d0') : (isLight ? '#b91c1c' : '#fecdd3') },
                    ]}
                  >
                    {statusBanner.text}
                  </Text>
                  <Pressable hitSlop={10} onPress={() => setStatusBanner(null)}>
                    <FeatherIcon name="x" size={14} color={isLight ? '#525252' : '#e2e8f0'} />
                  </Pressable>
                </View>
              ) : null}

              {!hideFinancialTools ? (
                <View style={styles.transactionRow}>
                  <Pressable
                    style={[styles.transactionIconButton, styles.transactionSend, transactionLoading && { opacity: 0.6 }]}
                    accessibilityLabel="حفظ المعاملة"
                    onPress={handleSaveTransaction}
                    disabled={transactionLoading}
                  >
                    {transactionLoading ? (
                      <ActivityIndicator size="small" color="#047857" />
                    ) : (
                      <FeatherIcon name="send" size={16} color="#047857" />
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.transactionIconButton, styles.transactionNote, note ? { borderWidth: 2, borderColor: '#f97316' } : null]}
                    accessibilityLabel="إضافة ملاحظة"
                    onPress={() => setNoteModalVisible(true)}
                  >
                    <FeatherIcon name="edit-3" size={16} color={isLight ? '#92400e' : '#facc15'} />
                  </Pressable>
                  <TextInput
                    value={theirShare}
                    onChangeText={setTheirShare}
                    placeholder="لكم"
                    placeholderTextColor={composerPlaceholderColor}
                    style={[styles.transactionInput, { color: tokens.textPrimary, borderColor: composerInputBorder, backgroundColor: composerInputBackground }]}
                    textAlign="center"
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    value={ourShare}
                    onChangeText={setOurShare}
                    placeholder="لنا"
                    placeholderTextColor={composerPlaceholderColor}
                    style={[styles.transactionInput, { color: tokens.textPrimary, borderColor: composerInputBorder, backgroundColor: composerInputBackground }]}
                    textAlign="center"
                    keyboardType="decimal-pad"
                  />
                  <Pressable
                    style={[styles.currencySelector, { borderColor: composerInputBorder, backgroundColor: composerButtonBackground }]}
                    accessibilityLabel="تغيير العملة"
                    onPress={() => setCurrencyPickerVisible(true)}
                  >
                    <Text style={[styles.currencyText, { color: tokens.textPrimary }]}>
                      {selectedCurrencyOption?.name || selectedCurrency}
                    </Text>
                    <FeatherIcon name="chevron-down" size={16} color={headerSecondaryText} />
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.messageRow}>
                <View style={styles.messageActions}>
                  <Pressable
                    accessibilityLabel="إرفاق ملف"
                    style={[styles.composerButton, { backgroundColor: composerButtonBackground, borderColor: composerButtonBorder }]}
                  >
                    <FeatherIcon name="paperclip" size={18} color={headerIconColor} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="إضافة رمز تعبيري"
                    onPress={() => setEmojiPickerVisible((prev) => !prev)}
                    style={[styles.composerButton, { backgroundColor: composerButtonBackground, borderColor: composerButtonBorder }]}
                  >
                    <Text style={{ fontSize: 18 }}>😊</Text>
                  </Pressable>
                </View>
                <View style={styles.messageFieldArea}>
                  <View
                    style={[
                      styles.composerInputWrapper,
                      {
                        backgroundColor: composerInputBackground,
                        borderColor: composerInputBorder,
                        minHeight: composerMinWrapperHeight,
                        maxHeight: composerMaxWrapperHeight,
                        height: composerWrapperHeight,
                      },
                    ]}
                  >
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="اكتب رسالة"
                      placeholderTextColor={composerPlaceholderColor}
                      multiline
                      onContentSizeChange={handleComposerContentSizeChange}
                      scrollEnabled={composerReachedMaxLines}
                      style={[
                        styles.composerInput,
                        {
                          color: tokens.textPrimary,
                          height: composerContentHeight,
                          maxHeight: composerMaxContentHeight,
                        },
                      ]}
                      textAlign="right"
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityLabel="إرسال الرسالة"
                  onPress={handleSend}
                  disabled={sendingMessage || !draft.trim()}
                  style={[
                    styles.sendButton,
                    { backgroundColor: '#f97316', opacity: sendingMessage || !draft.trim() ? 0.7 : 1 },
                  ]}
                >
                  {sendingMessage ? (
                    <ActivityIndicator size="small" color="#fff7ed" />
                  ) : (
                    <FeatherIcon name="send" size={18} color="#fff7ed" />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={emojiPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEmojiPickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setEmojiPickerVisible(false)}>
          <View
            style={[styles.emojiPanel, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>اختر رمزاً تعبيرياً</Text>
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.emojiGrid}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {EMOJI_PALETTE.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.emojiButton}
                  onPress={() => handleInsertEmoji(emoji)}
                >
                  <Text style={styles.emojiChar}>{emoji}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={currencyPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCurrencyPickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setCurrencyPickerVisible(false)}>
          <View
            style={[styles.modalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>اختر العملة</Text>
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.modalListContent}
              keyboardShouldPersistTaps="handled"
            >
              {currencyOptions.length === 0 ? (
                <Text style={[styles.modalEmptyText, { color: tokens.textMuted }]}>لا توجد عملات متاحة حالياً.</Text>
              ) : (
                currencyOptions.map((option) => {
                  const isActive = option.code === selectedCurrency;
                  return (
                    <Pressable
                      key={option.id ?? option.code}
                      style={[styles.modalOption, isActive && styles.modalOptionActive]}
                      onPress={() => {
                        setSelectedCurrency(option.code);
                        setCurrencyPickerVisible(false);
                      }}
                    >
                      <Text style={[styles.modalOptionText, { color: tokens.textPrimary }]}>
                        {option.name || option.code}
                      </Text>
                      <Text style={[styles.modalOptionSymbol, { color: tokens.textMuted }]}>
                        {option.symbol || option.code}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={noteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setNoteModalVisible(false)}>
          <View
            style={[styles.modalCard, { backgroundColor: tokens.panel, borderColor: tokens.divider }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>ملاحظة للمعاملة</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="أدخل ملاحظة اختيارية"
              placeholderTextColor={tokens.textMuted}
              style={[styles.noteInput, { color: tokens.textPrimary, borderColor: tokens.divider, backgroundColor: composerInputBackground }]}
              multiline
              textAlign="right"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, styles.modalButtonSecondary]} onPress={() => setNoteModalVisible(false)}>
                <Text style={[styles.modalButtonTextSecondary, { color: tokens.textPrimary }]}>إلغاء</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalButtonPrimary]} onPress={() => setNoteModalVisible(false)}>
                <Text style={styles.modalButtonTextPrimary}>حفظ</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  contactInfo: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: 8,
    marginHorizontal: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginStart: 'auto',
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginStart: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    marginStart: 10,
  },
  balanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  balanceChip: {
    marginStart: 16,
    marginBottom: 8,
  },
  balancePlaceholder: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  balancePlaceholderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b45309',
  },
  balanceText: {
    fontSize: 12,
    fontWeight: '700',
  },
  balanceCurrency: {
    fontSize: 11,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  listFooterSpacer: {
    height: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 13,
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    rowGap: 12,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  composerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInputWrapper: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'flex-start',
  },
  composerInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    minHeight: 32,
    fontWeight: '500',
    paddingVertical: 0,
    paddingHorizontal: 0,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    columnGap: 12,
  },
  transactionIconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionSend: {
    backgroundColor: '#d1fae5',
  },
  transactionNote: {
    backgroundColor: '#fef3c7',
  },
  transactionInput: {
    width: 88,
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  currencySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 42,
    columnGap: 6,
  },
  currencyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
  },
  messageFieldArea: {
    flex: 1,
  },
  messageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 22,
    rowGap: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  modalList: {
    maxHeight: 320,
    rowGap: 8,
  },
  modalListContent: {
    rowGap: 8,
    paddingVertical: 4,
  },
  modalEmptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  modalOption: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalOptionActive: {
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  modalOptionText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  modalOptionSymbol: {
    fontSize: 12,
    fontWeight: '500',
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  emojiPanel: {
    width: '90%',
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  emojiGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingVertical: 8,
  },
  emojiButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    marginHorizontal: 6,
    marginVertical: 6,
  },
  emojiChar: {
    fontSize: 26,
  },
  modalActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    columnGap: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    borderWidth: 1,
  },
  modalButtonPrimary: {
    backgroundColor: '#f97316',
  },
  modalButtonTextSecondary: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalButtonTextPrimary: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff7ed',
  },
});
