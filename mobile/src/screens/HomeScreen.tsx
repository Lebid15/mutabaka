import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import ConversationListItem from '../components/ConversationListItem';
import { conversations as mockConversations } from '../data/mock';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { environment } from '../config/environment';
import { clearAuthTokens, getAccessToken } from '../lib/authStorage';
import { HttpError } from '../lib/httpClient';
import { emitConversationPreviewUpdate, subscribeToConversationPreviewUpdates } from '../lib/conversationEvents';
import { createWebSocket } from '../lib/wsClient';
import {
  clearConversation,
  createConversationByUsername,
  fetchConversations,
  muteConversation,
  requestDeleteConversation,
  unmuteConversation,
  type ConversationDto,
} from '../services/conversations';
import { fetchSubscriptionOverview, type SubscriptionOverviewResponse } from '../services/subscriptions';
import { fetchCurrentUser, searchUsers, type CurrentUser, type PublicUser } from '../services/user';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'الآن';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'الآن';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const oneMinute = 60 * 1000;
  const oneHour = 60 * oneMinute;
  const oneDay = 24 * oneHour;

  if (diffMs < oneMinute) {
    return 'الآن';
  }
  if (diffMs < oneHour) {
    const minutes = Math.floor(diffMs / oneMinute);
    return `${minutes} دقيقة`;
  }
  if (diffMs < oneDay && date.getDate() === now.getDate()) {
    try {
      return date.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  if (diffMs < 2 * oneDay) {
    return 'أمس';
  }
  try {
    return date.toLocaleDateString('ar', { month: 'short', day: 'numeric' });
  } catch {
    return date.toLocaleDateString();
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (typeof error.payload === 'string') {
      return error.payload;
    }
    if (error.payload && typeof error.payload === 'object') {
      const payload = error.payload as Record<string, unknown>;
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      const firstEntry = Object.values(payload)[0];
      if (Array.isArray(firstEntry) && typeof firstEntry[0] === 'string') {
        return firstEntry[0];
      }
    }
    return error.message;
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

function getConversationSortValue(conversation: Pick<ConversationDto, 'last_message_at' | 'last_activity_at' | 'created_at'>): number {
  const source = conversation.last_message_at || conversation.last_activity_at || conversation.created_at;
  if (!source) {
    return 0;
  }
  const timestamp = new Date(source).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

type ConversationRecord = ConversationDto & {
  unread_count?: number;
  unreadCount?: number;
};

function normalizeUnreadCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed > 0 ? parsed : 0;
    }
  }
  return 0;
}

function withNormalizedUnread(conversation: ConversationDto): ConversationRecord {
  const raw = (conversation as Partial<ConversationRecord>).unread_count ?? (conversation as Partial<ConversationRecord>).unreadCount ?? 0;
  const normalized = normalizeUnreadCount(raw);
  return {
    ...conversation,
    unread_count: normalized,
    unreadCount: normalized,
  };
}

function getConversationUnread(conversation: ConversationRecord): number {
  const raw = conversation.unread_count ?? conversation.unreadCount ?? 0;
  return normalizeUnreadCount(raw);
}

function toTimestamp(source?: string | null): number {
  if (!source) {
    return 0;
  }
  const timestamp = new Date(source).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveNextUnread(previous: number, incoming: unknown, hasNewerMessage: boolean): number {
  const prev = normalizeUnreadCount(previous);
  const maxUnread = 999;

  if (incoming !== undefined && incoming !== null) {
    const normalizedIncoming = normalizeUnreadCount(incoming);
    if (normalizedIncoming === 0) {
      return 0;
    }
    if (hasNewerMessage) {
      const candidate = Math.max(prev + 1, normalizedIncoming);
      return Math.min(candidate, maxUnread);
    }
    if (normalizedIncoming < prev) {
      return Math.min(normalizedIncoming, maxUnread);
    }
    return Math.min(Math.max(prev, normalizedIncoming), maxUnread);
  }

  if (hasNewerMessage) {
    return Math.min(prev + 1, maxUnread);
  }

  return prev;
}

function mergeUnreadCounts(
  incoming: ConversationRecord[],
  previous: ConversationRecord[],
  locallyCleared: Set<number>,
): ConversationRecord[] {
  if (!previous.length) {
    incoming.forEach((conv) => {
      if (getConversationUnread(conv) > 0) {
        locallyCleared.delete(conv.id);
      }
    });
    return incoming;
  }

  const prevMap = new Map(previous.map((conv) => [conv.id, conv] as const));

  const merged = incoming.map((conv) => {
    const prev = prevMap.get(conv.id);
    const nextUnread = getConversationUnread(conv);

    if (!prev) {
      if (nextUnread > 0) {
        locallyCleared.delete(conv.id);
      }
      return conv;
    }

    const prevUnread = getConversationUnread(prev);

    if (nextUnread === 0) {
      if (locallyCleared.has(conv.id) || prevUnread === 0) {
        locallyCleared.delete(conv.id);
        return conv;
      }

      return {
        ...conv,
        unread_count: prevUnread,
        unreadCount: prevUnread,
      };
    }

    if (nextUnread < prevUnread && !locallyCleared.has(conv.id)) {
      return {
        ...conv,
        unread_count: prevUnread,
        unreadCount: prevUnread,
      };
    }

    if (nextUnread > 0) {
      locallyCleared.delete(conv.id);
    }

    return conv;
  });

  const idsPresent = new Set(merged.map((conv) => conv.id));
  locallyCleared.forEach((id) => {
    if (!idsPresent.has(id)) {
      locallyCleared.delete(id);
    }
  });

  return merged;
}

type MenuAction = 'profile' | 'matches' | 'settings' | 'subscriptions' | 'team' | 'refresh' | 'logout';

function decodeJwtPayload(token?: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    if (typeof globalThis.atob !== 'function') {
      return null;
    }
    const decoded = globalThis.atob(padded);
    return decoded ? JSON.parse(decoded) : null;
  } catch (error) {
    console.warn('[Mutabaka] Failed to decode JWT payload', error);
    return null;
  }
}

interface MenuItem {
  key: MenuAction;
  label: string;
  icon: ComponentProps<typeof FeatherIcon>['name'];
  path?: string;
  navigateTo?: 'Profile' | 'Matches' | 'Settings' | 'Subscriptions' | 'Team' | 'RefreshContacts';
}

type ConversationMenuAction = 'pin' | 'unpin' | 'mute' | 'unmute' | 'clear' | 'delete';

interface ConversationMenuOption {
  key: ConversationMenuAction;
  label: string;
  icon: ComponentProps<typeof FeatherIcon>['name'];
  danger: boolean;
  handler: () => void;
}

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const [searchValue, setSearchValue] = useState('');
  const [remoteConversations, setRemoteConversations] = useState<ConversationRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remoteLoadAttempted, setRemoteLoadAttempted] = useState(false);
  const [throttleUntil, setThrottleUntil] = useState<number | null>(null);
  const isMountedRef = useRef(true);
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<PublicUser[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [creatingConversationFor, setCreatingConversationFor] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSearchQueryRef = useRef('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isTeamActor, setIsTeamActor] = useState(false);
  const [showTrialBanner, setShowTrialBanner] = useState(false);
  const [trialBannerMessage, setTrialBannerMessage] = useState<string | null>(null);
  const [pinnedConversationIds, setPinnedConversationIds] = useState<number[]>([]);
  const [conversationMenu, setConversationMenu] = useState<{ id: number; title: string; subtitle: string; isMuted: boolean; isPinned: boolean } | null>(null);
  const [conversationActionState, setConversationActionState] = useState<{ id: number; action: 'pin' | 'unpin' | 'mute' | 'unmute' | 'clear' | 'delete' } | null>(null);
  const inboxSocketRef = useRef<WebSocket | null>(null);
  const isLight = mode === 'light';
  const webAppBaseUrl = useMemo(() => environment.apiBaseUrl.replace(/\/api\/?$/, ''), []);
  const remoteConversationsRef = useRef<ConversationRecord[]>(remoteConversations);
  const locallyClearedUnreadRef = useRef<Set<number>>(new Set());
  const loadConversationsInFlightRef = useRef(false);

  useEffect(() => {
    remoteConversationsRef.current = remoteConversations;
  }, [remoteConversations]);

  useEffect(() => () => {
    isMountedRef.current = false;
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    activeSearchQueryRef.current = '';
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!active) {
          return;
        }
        const payload = decodeJwtPayload(token) as { actor?: unknown } | null;
        const actorRaw = typeof payload?.actor === 'string' ? payload.actor.toLowerCase() : '';
        setIsTeamActor(actorRaw === 'team_member');
      } catch (error) {
        console.warn('[Mutabaka] Failed to decode auth token for subscription banner', error);
        if (active) {
          setIsTeamActor(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const resetAddContactState = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    activeSearchQueryRef.current = '';
    setContactQuery('');
    setContactResults([]);
    setContactSearching(false);
    setContactError(null);
    setCreatingConversationFor(null);
  }, []);

  const handleOpenAddContact = useCallback(() => {
    resetAddContactState();
    setIsAddContactOpen(true);
  }, [resetAddContactState]);

  const handleCloseAddContact = useCallback(() => {
    setIsAddContactOpen(false);
    resetAddContactState();
  }, [resetAddContactState]);

  const handleContactQueryChange = useCallback((value: string) => {
    setContactQuery(value);
    setContactError(null);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    const trimmed = value.trim();
    activeSearchQueryRef.current = trimmed;

    if (!trimmed) {
      setContactResults([]);
      setContactSearching(false);
      return;
    }

    if (trimmed.length < 2) {
      setContactResults([]);
      setContactSearching(false);
      return;
    }

    setContactSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      (async () => {
        try {
          const results = await searchUsers(trimmed);
          if (!isMountedRef.current || activeSearchQueryRef.current !== trimmed) {
            return;
          }
          setContactResults(results);
          setContactError(null);
        } catch (error) {
          if (!isMountedRef.current || activeSearchQueryRef.current !== trimmed) {
            return;
          }
          console.warn('[Mutabaka] searchUsers failed', error);
          setContactResults([]);
          setContactError(extractErrorMessage(error));
        } finally {
          if (!isMountedRef.current || activeSearchQueryRef.current !== trimmed) {
            return;
          }
          setContactSearching(false);
        }
      })();
    }, 320);
  }, []);

  const handleOpenMenu = useCallback(() => {
    setIsMenuOpen(true);
    setIsAddContactOpen(false);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const menuItems = useMemo<MenuItem[]>(() => (
    [
      { key: 'profile', label: 'بروفايلي', icon: 'user', navigateTo: 'Profile' },
      { key: 'matches', label: 'مطابقاتي', icon: 'heart', navigateTo: 'Matches' },
    { key: 'settings', label: 'الإعدادات', icon: 'settings', navigateTo: 'Settings' },
    { key: 'subscriptions', label: 'الاشتراك', icon: 'credit-card', navigateTo: 'Subscriptions' },
    { key: 'team', label: 'فريق العمل', icon: 'users', navigateTo: 'Team' },
    { key: 'refresh', label: 'تحديث جهات الاتصال', icon: 'refresh-ccw', navigateTo: 'RefreshContacts' },
      { key: 'logout', label: 'تسجيل الخروج', icon: 'log-out' },
    ]
  ), []);


  const loadConversations = useCallback(async () => {
    const now = Date.now();
    if (throttleUntil && now < throttleUntil) {
      const remainingSeconds = Math.max(0, Math.round((throttleUntil - now) / 1000));
      if (remainingSeconds > 0) {
        const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));
        setErrorMessage(`تم إيقاف الطلبات مؤقتًا. حاول مرة أخرى خلال حوالي ${minutes} دقيقة.`);
      }
      setRemoteLoadAttempted(true);
      setLoading(false);
      return;
    }
    if (loadConversationsInFlightRef.current) {
      return;
    }
    try {
      loadConversationsInFlightRef.current = true;
      setLoading(true);
      setErrorMessage(null);
      const subscriptionPromise: Promise<SubscriptionOverviewResponse | null> = !isTeamActor
        ? fetchSubscriptionOverview().catch((error) => {
          console.warn('[Mutabaka] Failed to load subscription overview', error);
          return null;
        })
        : Promise.resolve(null);

      const [me, conversationResponse, subscriptionOverview] = await Promise.all([
        fetchCurrentUser(),
        fetchConversations(),
        subscriptionPromise,
      ]);

      if (!isMountedRef.current) {
        return;
      }

      setCurrentUser(me);
      if (!isTeamActor) {
        const subscription = subscriptionOverview?.subscription ?? null;
        const remaining = typeof subscription?.remaining_days === 'number'
          ? subscription.remaining_days
          : (typeof me?.subscription_remaining_days === 'number' && Number.isFinite(me.subscription_remaining_days)
            ? me.subscription_remaining_days
            : null);
        const planCode = subscription?.plan?.code;
        const isTrialPlan = subscription?.is_trial === true || (typeof planCode === 'string' && planCode.toLowerCase() === 'trial');

        if (subscription && isTrialPlan && typeof remaining === 'number' && remaining > 0) {
          setTrialBannerMessage(`أنت على النسخة المجانية — متبقٍ ${remaining} يوم`);
          setShowTrialBanner(true);
        } else {
          setTrialBannerMessage(null);
          setShowTrialBanner(false);
        }
      } else {
        setTrialBannerMessage(null);
        setShowTrialBanner(false);
      }
      const incoming = Array.isArray(conversationResponse.results)
        ? conversationResponse.results
        : [];
      const normalized = incoming.map(withNormalizedUnread);
      const merged = mergeUnreadCounts(normalized, remoteConversationsRef.current, locallyClearedUnreadRef.current);
      const sorted = [...merged].sort((a, b) => getConversationSortValue(b) - getConversationSortValue(a));
      setRemoteConversations(sorted);
      setRemoteLoadAttempted(true);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      console.warn('[Mutabaka] Failed to load conversations', error);
      let message = 'تعذر تحميل المحادثات. تحقق من الاتصال بالخادم.';
      if (error instanceof HttpError) {
        if (error.status === 429) {
          let retrySeconds: number | null = null;
          const details = typeof error.message === 'string' ? error.message : '';
          let payloadDetail = '';
          if (error.payload && typeof error.payload === 'object' && 'detail' in error.payload) {
            const detailValue = (error.payload as Record<string, unknown>).detail;
            if (typeof detailValue === 'string') {
              payloadDetail = detailValue;
            }
          }
          const sourceText = payloadDetail || details;
          const secondsMatch = sourceText.match(/(\d+(?:\.\d+)?)\s*second/i);
          if (secondsMatch) {
            retrySeconds = Number.parseFloat(secondsMatch[1]);
            if (!Number.isFinite(retrySeconds)) {
              retrySeconds = null;
            }
          }
          if (retrySeconds && retrySeconds > 0) {
            const retryTimestamp = Date.now() + retrySeconds * 1000;
            setThrottleUntil(retryTimestamp);
            const minutes = Math.max(1, Math.ceil(retrySeconds / 60));
            message = `تم إيقاف الطلبات مؤقتًا بسبب معدل الاستخدام. حاول مرة أخرى خلال حوالي ${minutes} دقيقة.`;
          } else {
            message = 'تم إرسال طلبات كثيرة خلال وقت قصير. حاول مرة أخرى بعد لحظات.';
          }
        } else if (error.status >= 500) {
          message = 'الخادم يواجه انقطاعًا مؤقتًا. حاول مرة أخرى لاحقًا.';
        } else {
          const extracted = extractErrorMessage(error);
          if (extracted) {
            message = extracted;
          }
        }
      }
      setErrorMessage(message);
      setRemoteLoadAttempted(true);
    } finally {
      loadConversationsInFlightRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [isTeamActor, throttleUntil]);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations]),
  );

  useEffect(() => {
    if (!throttleUntil) {
      return;
    }

    const tick = () => {
      if (!isMountedRef.current) {
        return;
      }
      const now = Date.now();
      if (now >= throttleUntil) {
        setThrottleUntil(null);
        setErrorMessage(null);
        loadConversations();
        return;
      }
      const remainingSeconds = Math.max(0, Math.round((throttleUntil - now) / 1000));
      const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));
      setErrorMessage(`تم إيقاف الطلبات مؤقتًا. حاول مرة أخرى خلال حوالي ${minutes} دقيقة.`);
    };

    tick();
    const interval = setInterval(tick, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [loadConversations, throttleUntil]);

  useEffect(() => {
    setPinnedConversationIds((prev) => {
      const validPrev = prev.filter((id) => remoteConversations.some((conv) => conv.id === id));
      const remotePinned = remoteConversations
        .filter((conv) => {
          const meta = conv as unknown as { isPinned?: boolean; is_pinned?: boolean };
          return Boolean(meta?.isPinned) || Boolean(meta?.is_pinned);
        })
        .map((conv) => conv.id);
      const combined = new Set([...validPrev, ...remotePinned]);
      const next = Array.from(combined);
      if (next.length === prev.length && next.every((id) => prev.includes(id))) {
        return prev;
      }
      return next;
    });
  }, [remoteConversations]);

  useEffect(() => {
    const unsubscribe = subscribeToConversationPreviewUpdates((update) => {
      if (!update || !Number.isFinite(update.id)) {
        return;
      }
      if (update.removed) {
        setRemoteConversations((prev) => {
          if (!prev.length) {
            return prev;
          }
          const filtered = prev.filter((conv) => conv.id !== update.id);
          if (filtered.length === prev.length) {
            return prev;
          }
          return filtered;
        });
        locallyClearedUnreadRef.current.delete(update.id);
        setConversationMenu((current) => (current && current.id === update.id ? null : current));
        return;
      }
      let handled = false;
      setRemoteConversations((prev) => {
        if (!prev.length) {
          return prev;
        }
        let touched = false;
        const mapped = prev.map((conv) => {
          if (conv.id !== update.id) {
            return conv;
          }
          touched = true;
          const nextLastMessageAt = typeof update.lastMessageAt === 'string' && update.lastMessageAt.trim()
            ? update.lastMessageAt
            : conv.last_message_at;
          const nextLastActivityAt = typeof update.lastActivityAt === 'string' && update.lastActivityAt.trim()
            ? update.lastActivityAt
            : nextLastMessageAt ?? conv.last_activity_at;
          const incomingPreview = typeof update.lastMessagePreview === 'string' ? update.lastMessagePreview.trim() : '';
          const existingPreviewText = typeof conv.last_message_preview === 'string' ? conv.last_message_preview.trim() : '';
          const fallbackPreview = typeof conv.last_message_preview === 'string'
            ? conv.last_message_preview
            : conv.last_message_preview != null
              ? String(conv.last_message_preview)
              : '';
          const nextPreview = incomingPreview || existingPreviewText || fallbackPreview;
          const previousUnread = conv.unread_count ?? conv.unreadCount ?? 0;
          const hasNewerMessage = toTimestamp(nextLastMessageAt ?? undefined) > toTimestamp(conv.last_message_at ?? conv.last_activity_at ?? conv.created_at);
          const previewChanged = Boolean(incomingPreview) && incomingPreview !== existingPreviewText;
          const nextUnread = resolveNextUnread(previousUnread, update.unreadCount, hasNewerMessage || previewChanged);

          if (nextUnread > 0) {
            locallyClearedUnreadRef.current.delete(conv.id);
          }

          return {
            ...conv,
            last_message_at: nextLastMessageAt ?? conv.last_message_at,
            last_activity_at: nextLastActivityAt ?? conv.last_activity_at,
            last_message_preview: nextPreview,
            unread_count: nextUnread,
            unreadCount: nextUnread,
          };
        });

        if (!touched) {
          return prev;
        }

        mapped.sort((a, b) => getConversationSortValue(b) - getConversationSortValue(a));
        handled = true;
        return mapped;
      });

      if (!handled) {
        loadConversations();
      }

      setConversationMenu((current) => {
        if (!current || current.id !== update.id) {
          return current;
        }
        if (typeof update.lastMessagePreview !== 'string' || !update.lastMessagePreview.trim()) {
          return current;
        }
        return {
          ...current,
          subtitle: update.lastMessagePreview.trim(),
        };
      });
    });

    return unsubscribe;
  }, [loadConversations]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const cleanupSocket = () => {
      const existing = inboxSocketRef.current;
      if (existing) {
        existing.onopen = null;
        existing.onmessage = null;
        existing.onclose = null;
        existing.onerror = null;
        try {
          existing.close();
        } catch (error) {
          console.warn('[Mutabaka] Failed to close inbox socket', error);
        }
        inboxSocketRef.current = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };

    const scheduleReconnect = (delay = 3000) => {
      if (cancelled) {
        return;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled || !currentUser) {
        return;
      }
      try {
        const token = await getAccessToken();
        if (cancelled) {
          return;
        }
        const base = `${environment.websocketBaseUrl.replace(/\/+$/, '')}/inbox/`;
        const socket = createWebSocket(base, {
          token,
          query: {
            tenant: environment.tenantHost,
            tenant_host: environment.tenantHost,
          },
        });
        inboxSocketRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            return;
          }
          console.log('[Mutabaka] Inbox socket opened');
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          heartbeatInterval = setInterval(() => {
            try {
              socket.send(JSON.stringify({ type: 'ping' }));
            } catch (error) {
              console.warn('[Mutabaka] Inbox socket heartbeat failed', error);
            }
          }, 45000);
        };

        socket.onmessage = (event) => {
          if (!event.data) {
            return;
          }
          try {
            const data = JSON.parse(event.data);
            if (data?.type === 'inbox.update') {
              const conversationId = Number(data.conversation_id ?? data.conversationId);
              if (!Number.isFinite(conversationId)) {
                return;
              }
              const rawUnread = data.unread_count ?? data.unreadCount ?? data.unread;
              const hasUnreadValue = rawUnread !== undefined && rawUnread !== null;
              emitConversationPreviewUpdate({
                id: conversationId,
                lastMessageAt: data.last_message_at ?? data.lastMessageAt,
                lastActivityAt: data.last_activity_at ?? data.lastActivityAt ?? data.last_message_at ?? data.lastMessageAt,
                lastMessagePreview: data.last_message_preview ?? data.lastMessagePreview ?? data.preview,
                unreadCount: hasUnreadValue ? normalizeUnreadCount(rawUnread) : undefined,
              });
            }
          } catch (error) {
            console.warn('[Mutabaka] Failed to parse inbox message', error);
          }
        };

        socket.onerror = (error) => {
          console.warn('[Mutabaka] Inbox socket error event', error);
          try {
            socket.close();
          } catch {}
        };

        socket.onclose = (event) => {
          console.warn('[Mutabaka] Inbox socket closed', { code: event.code, reason: event.reason });
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          if (!cancelled) {
            scheduleReconnect();
          }
        };
      } catch (error) {
        console.warn('[Mutabaka] Failed to open inbox socket', error);
        scheduleReconnect();
      }
    };

    if (currentUser) {
      connect();
    }

    return () => {
      cancelled = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      cleanupSocket();
    };
  }, [currentUser]);

  const handleMenuSelect = useCallback(async (action: MenuAction) => {
    setIsMenuOpen(false);
    if (action === 'refresh') {
      navigation.navigate('RefreshContacts');
      return;
    }
    if (action === 'logout') {
      try {
        await clearAuthTokens();
      } catch (error) {
        console.warn('[Mutabaka] Failed to clear tokens during logout', error);
      }
    setRemoteConversations([]);
  locallyClearedUnreadRef.current.clear();
      setCurrentUser(null);
      setRemoteLoadAttempted(false);
    setThrottleUntil(null);
      resetAddContactState();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }

    const target = menuItems.find((item) => item.key === action);
    if (target?.navigateTo) {
      navigation.navigate(target.navigateTo);
      return;
    }
    if (target?.path) {
      const url = `${webAppBaseUrl}${target.path}`;
      try {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          throw new Error('unsupported');
        }
        await Linking.openURL(url);
      } catch (error) {
        console.warn('[Mutabaka] Failed to open url', url, error);
        Alert.alert('تعذر فتح الرابط', 'لم نتمكن من فتح الصفحة المطلوبة. حاول مرة أخرى من المتصفح.');
      }
    }
  }, [menuItems, navigation, resetAddContactState, webAppBaseUrl]);

  const openConversationMenu = useCallback((conversation: { id: number; title: string; subtitle: string; isMuted: boolean; isPinned: boolean }) => {
    setConversationMenu(conversation);
  }, []);

  const closeConversationMenu = useCallback(() => {
    setConversationMenu(null);
  }, []);

  const handleTogglePinConversation = useCallback(() => {
    const target = conversationMenu;
    if (!target) {
      return;
    }
    closeConversationMenu();
    const alreadyPinned = Boolean(target.isPinned);
    const actionType: ConversationMenuAction = alreadyPinned ? 'unpin' : 'pin';
    setConversationActionState({ id: target.id, action: actionType });
    setPinnedConversationIds((prev) => {
      if (alreadyPinned) {
        return prev.filter((id) => id !== target.id);
      }
      if (prev.includes(target.id)) {
        return prev;
      }
      return [...prev, target.id];
    });
  Alert.alert('تم', alreadyPinned ? 'تم إلغاء تثبيت المحادثة.' : 'تم تثبيت المحادثة.');
    setTimeout(() => {
      if (isMountedRef.current) {
        setConversationActionState(null);
      }
    }, 320);
  }, [closeConversationMenu, conversationMenu]);

  const handleToggleMuteConversation = useCallback(async () => {
    const target = conversationMenu;
    if (!target) {
      return;
    }
    closeConversationMenu();
    const isCurrentlyMuted = target.isMuted;
    const actionType = isCurrentlyMuted ? 'unmute' : 'mute';
    setConversationActionState({ id: target.id, action: actionType });
    try {
      if (isCurrentlyMuted) {
        await unmuteConversation(target.id);
      } else {
        await muteConversation(target.id);
      }

      setRemoteConversations((prev) => prev.map((conv) => (conv.id === target.id ? { ...conv, isMuted: !isCurrentlyMuted } : conv)));
      Alert.alert('تم', isCurrentlyMuted ? 'تم إلغاء كتم الإشعارات لهذه المحادثة.' : 'تم كتم إشعارات هذه المحادثة.');
    } catch (error) {
      Alert.alert('تعذر تنفيذ الإجراء', extractErrorMessage(error));
    } finally {
      setConversationActionState(null);
      loadConversations();
    }
  }, [closeConversationMenu, conversationMenu, loadConversations]);

  const handleClearConversation = useCallback(() => {
    const target = conversationMenu;
    if (!target) {
      return;
    }
    closeConversationMenu();
    Alert.alert(
      'مسح محتوى الدردشة',
      `سيتم حذف جميع الرسائل في المحادثة مع ${target.title}. لن يؤثر ذلك على المعاملات.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'مسح',
          style: 'destructive',
          onPress: async () => {
            setConversationActionState({ id: target.id, action: 'clear' });
            try {
              await clearConversation(target.id);
              setRemoteConversations((prev) => {
                const next = prev.map((conv) => (
                  conv.id === target.id
                    ? { ...conv, last_message_at: null, last_activity_at: null, last_message_preview: '' }
                    : conv
                ));
                return [...next].sort((a, b) => getConversationSortValue(b) - getConversationSortValue(a));
              });
              Alert.alert('تم', 'تم مسح محتوى الدردشة بنجاح.');
            } catch (error) {
              Alert.alert('تعذر المسح', extractErrorMessage(error));
            } finally {
              setConversationActionState(null);
              loadConversations();
            }
          },
        },
      ],
    );
  }, [clearConversation, closeConversationMenu, conversationMenu, loadConversations]);

  const handleRequestDeleteConversation = useCallback(() => {
    const target = conversationMenu;
    if (!target) {
      return;
    }
    closeConversationMenu();
    Alert.alert(
      'طلب حذف المحادثة',
      `سيتم إرسال طلب حذف للمحادثة مع ${target.title}. يجب أن يوافق الطرف الآخر لإتمام الحذف الكامل.`,
      [
        { text: 'تراجع', style: 'cancel' },
        {
          text: 'إرسال الطلب',
          style: 'destructive',
          onPress: async () => {
            setConversationActionState({ id: target.id, action: 'delete' });
            try {
              await requestDeleteConversation(target.id);
              Alert.alert('تم الإرسال', 'تم إرسال طلب الحذف للطرف الآخر.');
            } catch (error) {
              const requiresOtp = error instanceof HttpError && Boolean((error.payload as any)?.otp_required);
              if (requiresOtp) {
                Alert.alert('رمز التحقق مطلوب', 'الرجاء إدخال رمز OTP من تطبيق المصادقة ثم إعادة المحاولة.');
              } else {
                Alert.alert('تعذر إرسال الطلب', extractErrorMessage(error));
              }
            } finally {
              setConversationActionState(null);
              loadConversations();
            }
          },
        },
      ],
    );
  }, [closeConversationMenu, conversationMenu, loadConversations]);

  const handleStartConversation = useCallback(async (username: string) => {
    try {
      setCreatingConversationFor(username);
      setContactError(null);
      const conversation = await createConversationByUsername(username);
      if (!isMountedRef.current) {
        return;
      }
      await loadConversations();
      if (!isMountedRef.current) {
        return;
      }
      handleCloseAddContact();
      if (conversation?.id != null) {
        navigation.navigate('Chat', { conversationId: String(conversation.id) });
      }
    } catch (error) {
      console.warn('[Mutabaka] createConversationByUsername failed', error);
      if (!isMountedRef.current) {
        return;
      }
      setContactError(extractErrorMessage(error));
    } finally {
      if (!isMountedRef.current) {
        return;
      }
      setCreatingConversationFor(null);
    }
  }, [handleCloseAddContact, loadConversations, navigation]);

  const handleConversationPress = useCallback((conversationId: string) => {
    const numericId = Number(conversationId);
    if (Number.isFinite(numericId)) {
      locallyClearedUnreadRef.current.add(numericId);
    }
    setRemoteConversations((prev) => {
      if (!prev.length || !Number.isFinite(numericId)) {
        return prev;
      }
      let touched = false;
      const mapped = prev.map((conv) => {
        if (conv.id !== numericId) {
          return conv;
        }
        touched = true;
        return {
          ...conv,
          unread_count: 0,
          unreadCount: 0,
        };
      });
      return touched ? mapped : prev;
    });
    if (Number.isFinite(numericId)) {
      emitConversationPreviewUpdate({ id: numericId, unreadCount: 0 });
    }
    navigation.navigate('Chat', { conversationId });
  }, [navigation]);

  const pinnedSet = useMemo(() => new Set(pinnedConversationIds), [pinnedConversationIds]);

  const augmentedConversations = useMemo(() => {
    const isConversationPinned = (conversationId: number, meta?: { isPinned?: boolean; is_pinned?: boolean }): boolean => (
      pinnedSet.has(conversationId) || Boolean(meta?.isPinned) || Boolean(meta?.is_pinned)
    );

    if (remoteConversations.length && currentUser) {
      const sortedRemote = [...remoteConversations].sort((a, b) => {
        const aPinned = isConversationPinned(a.id, a as unknown as { isPinned?: boolean; is_pinned?: boolean });
        const bPinned = isConversationPinned(b.id, b as unknown as { isPinned?: boolean; is_pinned?: boolean });
        if (aPinned !== bPinned) {
          return aPinned ? -1 : 1;
        }
        return getConversationSortValue(b) - getConversationSortValue(a);
      });

      return sortedRemote.map((conv, index) => {
        const other = conv.user_a.id === currentUser.id ? conv.user_b : conv.user_a;
        const displayName = other.display_name || other.username;
        const previewText = typeof conv.last_message_preview === 'string' ? conv.last_message_preview.trim() : '';
        const subtitle = previewText || 'لا توجد رسائل حديثة بعد';
        const time = formatTimestamp(conv.last_message_at || conv.last_activity_at);
        const pinnedFlag = isConversationPinned(conv.id, conv as unknown as { isPinned?: boolean; is_pinned?: boolean });
        const unreadCount = getConversationUnread(conv);

        return {
          id: String(conv.id),
          title: displayName,
          subtitle,
          time,
          unreadCount,
          isPinned: pinnedFlag,
          isMuted: conv.isMuted,
          isActive: index === 0 && !searchValue.trim(),
          avatarUri: other.logo_url || undefined,
        };
      });
    }

    if (environment.name === 'production' || remoteLoadAttempted) {
      return [];
    }

    return mockConversations.map((conv, index) => {
  const numericId = Number((conv as { id?: string | number }).id);
      const meta = conv as unknown as { isPinned?: boolean };
  const derivedPinned = Number.isFinite(numericId) ? pinnedSet.has(numericId) : false;
      const finalPinned = derivedPinned || Boolean(meta?.isPinned) || (!pinnedSet.size && index === 0);
      const previewText = typeof conv.subtitle === 'string' ? conv.subtitle.trim() : '';

      return {
        ...conv,
        isPinned: finalPinned,
        isMuted: index === mockConversations.length - 1,
        subtitle: previewText || 'لا توجد رسائل حديثة بعد',
        avatarUri: undefined,
      };
    });
  }, [currentUser, pinnedSet, remoteConversations, remoteLoadAttempted, searchValue]);

  const filteredConversations = useMemo(() => (
    augmentedConversations.filter((conv) => {
      if (!searchValue.trim()) return true;
      const query = searchValue.trim();
      return conv.title.includes(query) || conv.subtitle.includes(query);
    })
  ), [augmentedConversations, searchValue]);

  const titleColor = isLight ? '#1f2937' : '#e2e8f0';
  const iconColor = isLight ? '#475569' : '#cbd5f5';
  const buttonBg = isLight ? '#ffffff' : '#0f1b22';
  const buttonBorder = isLight ? '#f0d9c2' : '#233138';
  const bannerBg = isLight ? '#fef3c7' : '#1f2937';
  const bannerBorder = isLight ? '#facc15' : '#334155';
  const bannerText = isLight ? '#78350f' : '#fde68a';
  const bannerCtaBg = isLight ? '#f97316' : '#facc15';
  const bannerCtaText = isLight ? '#fefce8' : '#1f2937';
  const bannerCloseColor = isLight ? '#a16207' : '#fde68a';
  const searchBg = isLight ? '#ffffff' : '#0f1b22';
  const searchBorder = isLight ? '#f0d9c2' : '#233138';
  const searchPlaceholder = isLight ? '#9ca3af' : '#64748b';
  const searchTextColor = isLight ? '#1f2937' : '#e2e8f0';
  const emptyTextColor = isLight ? '#6b7280' : '#94a3b8';
  const modalBackground = isLight ? '#ffffff' : '#0f1b22';
  const modalBorder = isLight ? '#f0d9c2' : '#233138';
  const modalTitleColor = isLight ? '#1f2937' : '#e2e8f0';
  const modalSubtitleColor = isLight ? '#6b7280' : '#94a3b8';
  const modalInputBg = isLight ? '#f9fafb' : '#152430';
  const modalInputBorder = isLight ? '#e5e7eb' : '#1f2d35';
  const modalInputTextColor = isLight ? '#1f2937' : '#f8fafc';
  const modalInputPlaceholder = isLight ? '#9ca3af' : '#64748b';
  const modalDivider = isLight ? '#f1f5f9' : '#1e293b';
  const modalResultUsername = isLight ? '#9ca3af' : '#64748b';
  const modalEmptyText = isLight ? '#6b7280' : '#94a3b8';
  const modalErrorColor = isLight ? '#b91c1c' : '#fecaca';
  const modalErrorBackground = isLight ? '#fee2e2' : '#7f1d1d';
  const actionTint = isLight ? '#f97316' : '#facc15';
  const actionTintContrast = isLight ? '#fefce8' : '#1f2937';
  const menuBackground = modalBackground;
  const menuBorder = modalBorder;
  const menuItemText = isLight ? '#1f2937' : '#e2e8f0';
  const menuIconColor = actionTint;
  const menuSecondaryText = isLight ? '#6b7280' : '#94a3b8';
  const menuDangerText = isLight ? '#dc2626' : '#fecaca';
  const menuDangerBackground = isLight ? '#fee2e2' : '#7f1d1d';

  const conversationMenuOptions = useMemo<ConversationMenuOption[]>(() => {
    if (!conversationMenu) {
      return [];
    }

    const isMuted = Boolean(conversationMenu.isMuted);
    const isPinned = Boolean(conversationMenu.isPinned);
    const muteOptionKey: ConversationMenuAction = isMuted ? 'unmute' : 'mute';
    const muteIcon: ComponentProps<typeof FeatherIcon>['name'] = isMuted ? 'volume-2' : 'volume-x';
    const pinOptionKey: ConversationMenuAction = isPinned ? 'unpin' : 'pin';
  const pinLabel = isPinned ? 'إلغاء تثبيت المحادثة' : 'تثبيت المحادثة';

    return [
      {
        key: pinOptionKey,
        label: pinLabel,
        icon: 'bookmark',
        danger: false,
        handler: handleTogglePinConversation,
      },
      {
        key: muteOptionKey,
        label: isMuted ? 'إلغاء كتم الإشعارات' : 'كتم الإشعارات',
        icon: muteIcon,
        danger: false,
        handler: handleToggleMuteConversation,
      },
      {
        key: 'clear',
        label: 'مسح محتوى الدردشة',
        icon: 'trash-2',
        danger: true,
        handler: handleClearConversation,
      },
      {
        key: 'delete',
        label: 'طلب حذف المحادثة',
        icon: 'alert-triangle',
        danger: true,
        handler: handleRequestDeleteConversation,
      },
    ];
  }, [conversationMenu, handleClearConversation, handleRequestDeleteConversation, handleToggleMuteConversation, handleTogglePinConversation]);

  const conversationMenuModal = (
    <Modal
      visible={Boolean(conversationMenu)}
      animationType="fade"
      transparent
      onRequestClose={closeConversationMenu}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.modalBackdrop} onPress={closeConversationMenu} />
        <View
          style={[styles.menuContent, { backgroundColor: menuBackground, borderColor: menuBorder }]}
          accessibilityViewIsModal
        >
          <View style={styles.menuHeader}>
            <View style={styles.conversationMenuTitleGroup}>
              <Text style={[styles.menuTitle, { color: menuItemText }]} numberOfLines={1}>
                {conversationMenu?.title || 'المحادثة'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق قائمة المحادثة"
              style={styles.modalCloseButton}
              onPress={closeConversationMenu}
            >
              <FeatherIcon name="x" size={18} color={menuSecondaryText} />
            </Pressable>
          </View>
          <View style={styles.menuItems}>
            {conversationMenuOptions.map((option) => {
              const isDanger = option.danger;
              const iconTint = isDanger ? menuDangerText : menuIconColor;
              const textColor = isDanger ? menuDangerText : menuItemText;
              const iconWrapperTint = isDanger ? `${menuDangerText}20` : `${actionTint}20`;
              const itemStyle = [
                styles.menuItem,
                isDanger ? { backgroundColor: menuDangerBackground } : null,
              ];
              return (
                <Pressable
                  key={option.key}
                  style={itemStyle}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  onPress={option.handler}
                >
                  <View style={styles.menuItemContent}>
                    <View style={[styles.menuIconWrapper, { backgroundColor: iconWrapperTint }]}>
                      <FeatherIcon name={option.icon} size={18} color={iconTint} />
                    </View>
                    <Text style={[styles.menuItemText, { color: textColor }]}>{option.label}</Text>
                  </View>
                  <FeatherIcon
                    name="chevron-left"
                    size={18}
                    color={isDanger ? menuDangerText : menuSecondaryText}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );

  const handleBannerCtaPress = useCallback(() => {
    navigation.navigate('Subscriptions');
  }, [navigation]);

  const handleDismissTrialBanner = useCallback(() => {
    setShowTrialBanner(false);
  }, []);

  const listHeader = (
    <View style={styles.listHeader}>
      {showTrialBanner && trialBannerMessage ? (
        <View
          style={[styles.banner, { backgroundColor: bannerBg, borderColor: bannerBorder }]}
          accessibilityRole="alert"
        >
          <Text
            style={[styles.bannerText, { color: bannerText }]}
            numberOfLines={2}
          >
            {trialBannerMessage}
          </Text>
          <View style={styles.bannerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="الانتقال إلى صفحة الاشتراك"
              style={[styles.bannerAction, { backgroundColor: bannerCtaBg }]}
              onPress={handleBannerCtaPress}
            >
              <Text style={[styles.bannerActionText, { color: bannerCtaText }]}>اذهب لصفحة الاشتراك</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق التنبيه"
              style={styles.bannerClose}
              onPress={handleDismissTrialBanner}
            >
              <FeatherIcon name="x" size={16} color={bannerCloseColor} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.headerRow}>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: titleColor }]}>الدردشات</Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.iconButton, styles.headerButton, { backgroundColor: buttonBg, borderColor: buttonBorder }]}
            onPress={handleOpenAddContact}
            accessibilityLabel="إضافة جهة اتصال جديدة"
          >
            <FeatherIcon name="plus" size={20} color={actionTint} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          style={[styles.iconButton, styles.headerButton, { backgroundColor: buttonBg, borderColor: buttonBorder }]}
          onPress={handleOpenMenu}
          accessibilityLabel="فتح قائمة الصفحات"
        >
          <FeatherIcon name="more-vertical" size={20} color={iconColor} />
        </Pressable>
      </View>

      <View
        style={[styles.searchWrapper, { backgroundColor: searchBg, borderColor: searchBorder }]}
        pointerEvents="box-none"
      >
        <FeatherIcon name="search" size={18} color={isLight ? '#f97316' : '#94a3b8'} style={styles.searchIcon} />
        <TextInput
          value={searchValue}
          onChangeText={setSearchValue}
          placeholder="ابحث في المحادثات"
          placeholderTextColor={searchPlaceholder}
          style={[styles.searchInput, { color: searchTextColor }]}
          textAlign="right"
        />
      </View>
    </View>
  );

  const addContactModal = (
    <Modal
      visible={isAddContactOpen}
      animationType="fade"
      transparent
      onRequestClose={handleCloseAddContact}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.modalBackdrop} onPress={handleCloseAddContact} />
        <View style={[styles.modalContent, { backgroundColor: modalBackground, borderColor: modalBorder }]}
          accessibilityViewIsModal
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: modalTitleColor }]}>إضافة جهة اتصال</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق نافذة إضافة جهة الاتصال"
              style={styles.modalCloseButton}
              onPress={handleCloseAddContact}
            >
              <FeatherIcon name="x" size={18} color={modalSubtitleColor} />
            </Pressable>
          </View>
          <Text style={[styles.modalSubtitle, { color: modalSubtitleColor }]}
            numberOfLines={2}
          >
            ابحث عن المستخدمين باستخدام اسم المستخدم لبدء محادثة مباشرة معهم.
          </Text>
          <View style={[styles.modalInputWrapper, { backgroundColor: modalInputBg, borderColor: modalInputBorder }]}
            accessibilityLabel="حقل البحث عن المستخدمين"
          >
            <FeatherIcon name="search" size={18} color={actionTint} style={styles.modalInputIcon} />
            <TextInput
              value={contactQuery}
              onChangeText={handleContactQueryChange}
              placeholder="ادخل اسم المستخدم"
              placeholderTextColor={modalInputPlaceholder}
              style={[styles.modalInput, { color: modalInputTextColor }]}
              autoCorrect={false}
              autoCapitalize="none"
              textAlign="right"
              autoFocus
              returnKeyType="search"
            />
          </View>
          {contactError ? (
            <View style={[styles.modalErrorBanner, { backgroundColor: modalErrorBackground }]}> 
              <Text style={[styles.modalErrorText, { color: modalErrorColor }]}>{contactError}</Text>
            </View>
          ) : null}
          <View style={[styles.modalDivider, { backgroundColor: modalDivider }]} />
          <ScrollView style={styles.modalResults} keyboardShouldPersistTaps="handled">
            {contactSearching ? (
              <ActivityIndicator size="small" color={actionTint} />
            ) : contactQuery.trim().length === 0 ? (
              <Text style={[styles.modalEmptyText, { color: modalEmptyText }]}>ابدأ بالبحث عن طريق كتابة اسم المستخدم.</Text>
            ) : contactQuery.trim().length < 2 ? (
              <Text style={[styles.modalEmptyText, { color: modalEmptyText }]}>اكتب على الأقل حرفين لإظهار النتائج.</Text>
            ) : contactResults.length === 0 ? (
              <Text style={[styles.modalEmptyText, { color: modalEmptyText }]}>لا توجد نتائج مطابقة.</Text>
            ) : (
              contactResults.map((user) => {
                const isCreatingThis = creatingConversationFor === user.username;
                const isCreatingAnother = creatingConversationFor !== null && !isCreatingThis;
                return (
                  <View key={`${user.id ?? user.username}-${user.username}`}
                    style={[styles.modalResultRow, { borderColor: modalDivider }]}
                  >
                    <View style={styles.modalResultInfo}>
                      <Text style={[styles.modalResultTitle, { color: modalTitleColor }]} numberOfLines={1}>
                        {user.display_name || user.username}
                      </Text>
                      <Text style={[styles.modalResultSubtitle, { color: modalResultUsername }]} numberOfLines={1}>
                        @{user.username}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`بدء محادثة مع ${user.display_name || user.username}`}
                      style={[styles.modalActionButton, { backgroundColor: actionTint, opacity: isCreatingAnother ? 0.65 : 1 }]}
                      onPress={() => handleStartConversation(user.username)}
                      disabled={isCreatingAnother}
                    >
                      {isCreatingThis ? (
                        <ActivityIndicator size="small" color={actionTintContrast} />
                      ) : (
                        <Text style={[styles.modalActionText, { color: actionTintContrast }]}>ابدأ</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const menuModal = (
    <Modal
      visible={isMenuOpen}
      animationType="fade"
      transparent
      onRequestClose={handleCloseMenu}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.modalBackdrop} onPress={handleCloseMenu} />
        <View
          style={[styles.menuContent, { backgroundColor: menuBackground, borderColor: menuBorder }]}
          accessibilityViewIsModal
        >
          <View style={styles.menuHeader}>
            <Text style={[styles.menuTitle, { color: menuItemText }]}>القائمة</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق القائمة"
              style={styles.modalCloseButton}
              onPress={handleCloseMenu}
            >
              <FeatherIcon name="x" size={18} color={menuSecondaryText} />
            </Pressable>
          </View>
          <View style={styles.menuItems}>
            {menuItems.map((item) => {
              const isDanger = item.key === 'logout';
              const itemIconColor = isDanger ? menuDangerText : menuIconColor;
              const itemTextColor = isDanger ? menuDangerText : menuItemText;
              const itemStyle = [
                styles.menuItem,
                isDanger ? { backgroundColor: menuDangerBackground } : null,
              ];
              return (
                <Pressable
                  key={item.key}
                  style={itemStyle}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => handleMenuSelect(item.key)}
                >
                  <View style={styles.menuItemContent}>
                    <View style={[styles.menuIconWrapper, { backgroundColor: isDanger ? 'transparent' : `${actionTint}20` }]}
                    >
                      <FeatherIcon name={item.icon} size={18} color={itemIconColor} />
                    </View>
                    <Text style={[styles.menuItemText, { color: itemTextColor }]}>{item.label}</Text>
                  </View>
                  <FeatherIcon name="chevron-left" size={18} color={isDanger ? menuDangerText : menuSecondaryText} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screenContainer}>
          {errorMessage ? (
            <View style={[styles.errorBanner, { backgroundColor: isLight ? '#fee2e2' : '#7f1d1d' }]}> 
              <Text style={{ color: isLight ? '#991b1b' : '#fecdd3', textAlign: 'center', fontSize: 12, fontWeight: '600' }}>
                {errorMessage}
              </Text>
            </View>
          ) : null}
          <FlatList
            data={filteredConversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => {
              const numericId = Number(item.id);
              const isActionLoading = conversationActionState?.id === numericId;
              return (
                <ConversationListItem
                  title={item.title}
                  subtitle={item.subtitle}
                  time={item.time}
                  unreadCount={item.unreadCount}
                  isPinned={item.isPinned}
                  isMuted={item.isMuted}
                  isActive={index === 0 && !searchValue.trim()}
                  avatarUri={item.avatarUri}
                  onPress={() => handleConversationPress(item.id)}
                  onEditPress={() => {
                    if (!Number.isFinite(numericId)) {
                      return;
                    }
                    openConversationMenu({
                      id: numericId,
                      title: item.title,
                      subtitle: item.subtitle,
                      isMuted: Boolean(item.isMuted),
                      isPinned: Boolean(item.isPinned),
                    });
                  }}
                  editLoading={Boolean(isActionLoading)}
                />
              );
            }}
            ListHeaderComponent={listHeader}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshing={loading}
            onRefresh={loadConversations}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                {loading ? (
                  <ActivityIndicator size="small" color={actionTint} />
                ) : throttleUntil && throttleUntil > Date.now() ? (
                  <Text style={[styles.emptyText, { color: emptyTextColor }]}>انتظر انتهاء الإيقاف المؤقت قبل إعادة المحاولة.</Text>
                ) : errorMessage ? (
                  <Text style={[styles.emptyText, { color: emptyTextColor }]}>اسحب للأسفل لإعادة المحاولة.</Text>
                ) : searchValue.trim() ? (
                  <Text style={[styles.emptyText, { color: emptyTextColor }]}>لا توجد محادثات مطابقة للبحث</Text>
                ) : remoteLoadAttempted ? (
                  <Text style={[styles.emptyText, { color: emptyTextColor }]}>لا توجد محادثات بعد.</Text>
                ) : (
                  <Text style={[styles.emptyText, { color: emptyTextColor }]}>جارٍ تحميل المحادثات...</Text>
                )}
              </View>
            )}
          />
          {addContactModal}
          {menuModal}
          {conversationMenuModal}
        </View>
      </SafeAreaView>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  errorBanner: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  listHeader: {
    paddingTop: 24,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerButton: {
    marginStart: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginBottom: 16,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerAction: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    marginEnd: 8,
  },
  bannerActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  bannerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: 4,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  searchIcon: {
    marginStart: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 32,
  },
  emptyState: {
    paddingVertical: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalContent: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 16,
  },
  modalInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalInputIcon: {
    marginStart: 12,
    marginEnd: 6,
  },
  modalInput: {
    flex: 1,
    fontSize: 14,
  },
  modalErrorBanner: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  modalErrorText: {
    fontSize: 12,
    textAlign: 'right',
    fontWeight: '600',
  },
  modalDivider: {
    height: 1,
    borderRadius: 999,
    marginTop: 18,
    marginBottom: 12,
  },
  modalResults: {
    maxHeight: 320,
    marginTop: 8,
  },
  modalEmptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  modalResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalResultInfo: {
    flex: 1,
    marginEnd: 12,
  },
  modalResultTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  modalResultSubtitle: {
    fontSize: 12,
  },
  modalActionButton: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  menuContent: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  conversationMenuTitleGroup: {
    flex: 1,
    alignItems: 'flex-end',
    marginEnd: 12,
  },
  menuItems: {
    marginTop: 4,
  },
  menuItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 8,
  },
  menuItemContent: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  menuIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: 12,
    marginEnd: 8,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
});
