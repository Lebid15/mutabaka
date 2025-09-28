import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  I18nManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { HttpError } from '../lib/httpClient';
import {
  fetchConversations,
  type ConversationDto,
} from '../services/conversations';
import {
  fetchCurrentUser,
  type CurrentUser,
} from '../services/user';

interface ContactSummary {
  id: string;
  name: string;
  username?: string | null;
  avatarUri?: string | null;
  initials: string;
  lastPreview: string;
  lastActivityAt?: string | null;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return 'لا توجد بيانات';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'غير معروف';
  }
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return 'الآن';
  }
  if (diff < hour) {
    const mins = Math.floor(diff / minute);
    return `${mins} دقيقة`;
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours} ساعة`;
  }
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return date.toLocaleString('ar', options);
  } catch {
    return date.toLocaleString(undefined, options);
  }
}

async function fetchAllConversations(): Promise<ConversationDto[]> {
  const aggregated: ConversationDto[] = [];
  let page = 1;
  let guard = 0;
  while (guard < MAX_PAGES) {
    const response = await fetchConversations({ page, pageSize: PAGE_SIZE });
    aggregated.push(...response.results);
    if (!response.next) {
      break;
    }
    page += 1;
    guard += 1;
  }
  return aggregated;
}

function pickOtherUser(conversation: ConversationDto, currentUserId?: number) {
  if (currentUserId && conversation.user_a?.id === currentUserId) {
    return conversation.user_b;
  }
  if (currentUserId && conversation.user_b?.id === currentUserId) {
    return conversation.user_a;
  }
  return conversation.user_b || conversation.user_a;
}

function mapConversationToContact(conversation: ConversationDto, currentUserId?: number): ContactSummary {
  const other = pickOtherUser(conversation, currentUserId);
  const name = other?.display_name || other?.username || 'مستخدم';
  const username = other?.username || null;
  const initials = (name || 'U').slice(0, 2).toUpperCase();
  const preview = conversation.last_message_preview || 'لا توجد رسائل حديثة بعد';
  const lastActivity = conversation.last_message_at || conversation.last_activity_at || conversation.created_at;
  return {
    id: String(conversation.id),
    name,
    username,
    avatarUri: other?.logo_url || null,
    initials,
    lastPreview: preview,
    lastActivityAt: lastActivity,
  };
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    if (typeof error.payload === 'string' && error.payload.trim()) {
      return error.payload;
    }
    if (error.payload && typeof error.payload === 'object') {
      const payload = error.payload as Record<string, unknown>;
      if (typeof payload.detail === 'string') {
        return payload.detail;
      }
      for (const value of Object.values(payload)) {
        if (typeof value === 'string') {
          return value;
        }
        if (Array.isArray(value) && typeof value[0] === 'string') {
          return value[0];
        }
      }
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export default function RefreshContactsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isRTL = I18nManager.isRTL;

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const palette = useMemo(() => ({
    panelBg: isLight ? 'rgba(255,255,255,0.95)' : '#0f1b22',
    panelBorder: isLight ? '#f2cdaa' : '#233138',
    headerIcon: isLight ? '#f97316' : '#facc15',
    headerText: isLight ? '#1f2937' : '#e2e8f0',
    title: isLight ? '#3b2f24' : '#f8fafc',
    subText: isLight ? '#7f6958' : '#94a3b8',
    badgeSuccessBg: isLight ? '#dcfce7' : 'rgba(22,163,74,0.2)',
    badgeSuccessText: isLight ? '#166534' : '#bbf7d0',
    badgeErrorBg: isLight ? '#fee2e2' : 'rgba(248,113,113,0.25)',
    badgeErrorText: isLight ? '#b91c1c' : '#fecaca',
    statBg: isLight ? '#fff5e8' : '#13222b',
    statBorder: isLight ? '#f1c8a4' : '#1f2d35',
    statTitle: isLight ? '#6f5b4a' : '#94a3b8',
    statValue: isLight ? '#3b2f24' : '#f8fafc',
    buttonPrimaryBg: isLight ? '#2f9d73' : '#059669',
    buttonPrimaryText: '#ffffff',
    buttonSecondaryBg: isLight ? '#2563EB' : '#1d4ed8',
    buttonSecondaryText: '#ffffff',
    buttonDisabledBg: isLight ? '#d1d5db' : '#374151',
    contactCardBg: isLight ? '#fff9f1' : '#13222b',
    contactBorder: isLight ? '#f3d8bb' : '#1f2d35',
    contactText: isLight ? '#3b2f24' : '#f8fafc',
    contactSubText: isLight ? '#7f6958' : '#94a3b8',
    contactMeta: isLight ? '#9a8878' : '#94a3b8',
    avatarBg: isLight ? '#fde68a' : '#facc15',
  }), [isLight]);

  const loadData = useCallback(async (showStatus?: boolean) => {
    setError(null);
    setAuthRequired(false);
    if (showStatus) {
      setStatusMessage(null);
    }
    try {
      const [user, conversations] = await Promise.all([
        fetchCurrentUser(),
        fetchAllConversations(),
      ]);
      const mapped = conversations.map((conversation) => mapConversationToContact(conversation, user.id));
      setCurrentUser(user);
      setContacts(mapped);
      const now = new Date();
      setLastUpdated(now);
      if (showStatus) {
        setStatusMessage({ kind: 'success', text: 'تم تحديث جهات الاتصال' });
      }
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        setAuthRequired(true);
      } else {
        const message = extractErrorMessage(err, 'تعذر تحميل جهات الاتصال');
        setError(message);
        if (showStatus) {
          setStatusMessage({ kind: 'error', text: message });
        }
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        await loadData(false);
        if (active) {
          setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [loadData]),
  );

  const handleRefresh = useCallback(async () => {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    try {
      await loadData(true);
    } finally {
      setRefreshing(false);
    }
  }, [loadData, refreshing]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) {
      return 'لم يتم التحديث بعد';
    }
    return formatRelativeTime(lastUpdated.toISOString());
  }, [lastUpdated]);

  const contactPreview = contacts.slice(0, 10);

  const renderStatusMessage = () => {
    if (!statusMessage) {
      return null;
    }
    const isSuccess = statusMessage.kind === 'success';
    return (
      <View
        style={[styles.statusBanner, {
          backgroundColor: isSuccess ? palette.badgeSuccessBg : palette.badgeErrorBg,
          borderColor: isSuccess ? palette.badgeSuccessText : palette.badgeErrorText,
        }]}
      >
        <FeatherIcon
          name={isSuccess ? 'check-circle' : 'alert-circle'}
          size={18}
          color={isSuccess ? palette.badgeSuccessText : palette.badgeErrorText}
        />
        <Text
          style={[styles.statusText, { color: isSuccess ? palette.badgeSuccessText : palette.badgeErrorText }]}
        >
          {statusMessage.text}
        </Text>
      </View>
    );
  };

  const renderContent = () => {
    if (authRequired) {
      return (
        <View style={[styles.messageCard, { borderColor: palette.panelBorder, backgroundColor: palette.panelBg }]}
        >
          <Text style={[styles.messageTitle, { color: palette.title }]}>الرجاء تسجيل الدخول أولاً</Text>
          <Text style={[styles.messageText, { color: palette.subText }]}>هذه الميزة متاحة للمستخدمين المسجلين فقط.</Text>
          <Pressable
            style={[styles.secondaryButton, { backgroundColor: palette.buttonSecondaryBg }]}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.buttonSecondaryText }]}>الانتقال للرئيسية</Text>
          </Pressable>
        </View>
      );
    }

    if (loading) {
      return (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={palette.headerIcon} />
          <Text style={[styles.loadingText, { color: palette.subText }]}>جارٍ تحميل جهات الاتصال…</Text>
        </View>
      );
    }

    if (error && contacts.length === 0) {
      return (
        <View style={styles.loadingState}>
          <Text style={[styles.errorText, { color: palette.badgeErrorText }]}>{error}</Text>
          <Pressable
            style={[styles.secondaryButton, { backgroundColor: palette.buttonSecondaryBg }]}
            onPress={handleRefresh}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.buttonSecondaryText }]}>أعد المحاولة</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.sectionStack}>
        {renderStatusMessage()}

        <View style={[styles.summaryCard, { backgroundColor: palette.statBg, borderColor: palette.statBorder }]}
        >
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: palette.statTitle }]}>إجمالي الجهات</Text>
            <Text style={[styles.summaryValue, { color: palette.statValue }]}>{contacts.length}</Text>
          </View>
          <View style={styles.summarySeparator} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: palette.statTitle }]}>آخر تحديث</Text>
            <Text style={[styles.summaryValue, { color: palette.statValue }]}>{lastUpdatedLabel}</Text>
          </View>
        </View>

        <View style={[styles.actionsRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
        >
          <Pressable
            style={[styles.primaryButton, {
              backgroundColor: refreshing ? palette.buttonDisabledBg : palette.buttonPrimaryBg,
              opacity: refreshing ? 0.8 : 1,
            }]}
            onPress={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={palette.buttonPrimaryText} />
            ) : (
              <>
                <FeatherIcon name="refresh-ccw" size={18} color={palette.buttonPrimaryText} />
                <Text style={[styles.primaryButtonText, { color: palette.buttonPrimaryText }]}>تحديث الآن</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, { backgroundColor: palette.buttonSecondaryBg }]}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.buttonSecondaryText }]}>العودة للمحادثات</Text>
          </Pressable>
        </View>

        <View style={styles.previewHeader}>
          <Text style={[styles.previewTitle, { color: palette.title }]}>أحدث جهات الاتصال</Text>
          <Text style={[styles.previewSubtitle, { color: palette.subText }]}>يتم عرض أول {contactPreview.length} من إجمالي {contacts.length}</Text>
        </View>

        {contactPreview.length === 0 ? (
          <Text style={[styles.emptyText, { color: palette.subText }]}>لا توجد جهات اتصال حتى الآن.</Text>
        ) : (
          contactPreview.map((contact) => (
            <View key={contact.id} style={[styles.contactCard, { borderColor: palette.contactBorder, backgroundColor: palette.contactCardBg }]}
            >
              <View style={[styles.contactHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              >
                <View style={[styles.avatar, { backgroundColor: palette.avatarBg }]}
                >
                  {contact.avatarUri ? (
                    <Image source={{ uri: contact.avatarUri }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{contact.initials}</Text>
                  )}
                </View>
                <View style={styles.contactHeaderText}>
                  <Text style={[styles.contactName, { color: palette.contactText }]}>{contact.name}</Text>
                  {contact.username ? (
                    <Text style={[styles.contactUsername, { color: palette.contactSubText }]}>@{contact.username}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={[styles.contactPreview, { color: palette.contactSubText }]} numberOfLines={2}>{contact.lastPreview}</Text>
              <View style={[styles.contactMeta, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
              >
                <FeatherIcon name="clock" size={14} color={palette.contactMeta} />
                <Text style={[styles.contactMetaText, { color: palette.contactMeta }]}>{formatRelativeTime(contact.lastActivityAt)}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    );
  };

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View
            style={[styles.header, {
              backgroundColor: palette.panelBg,
              borderColor: palette.panelBorder,
              flexDirection: isRTL ? 'row-reverse' : 'row',
            }]}
          >
            <View style={[styles.headerContent, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="رجوع"
                style={styles.headerButton}
                onPress={() => navigation.goBack()}
              >
                <FeatherIcon name={isRTL ? 'chevron-left' : 'chevron-right'} size={22} color={palette.headerIcon} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: palette.headerText }]}>تحديث جهات الاتصال</Text>
            </View>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.panel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}>
              {renderContent()}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  header: {
    margin: 16,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerContent: {
    alignItems: 'center',
  },
  headerButton: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
  },
  loadingState: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  messageCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  messageTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  messageText: {
    fontSize: 13,
    textAlign: 'center',
  },
  sectionStack: {
    gap: 16,
  },
  statusBanner: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  summarySeparator: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  actionsRow: {
    gap: 12,
    alignItems: 'center',
  },
  primaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  previewHeader: {
    gap: 4,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  previewSubtitle: {
    fontSize: 12,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  contactCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  contactHeader: {
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
  },
  contactHeaderText: {
    flex: 1,
    gap: 4,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactUsername: {
    fontSize: 12,
  },
  contactPreview: {
    fontSize: 13,
    lineHeight: 18,
  },
  contactMeta: {
    alignItems: 'center',
    gap: 6,
  },
  contactMetaText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
