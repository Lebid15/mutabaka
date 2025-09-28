import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  fetchSubscriptionOverview,
  fetchSubscriptionPlans,
  renewSubscription,
  type PlanCode,
  type SubscriptionOverviewResponse,
  type SubscriptionPlan,
} from '../services/subscriptions';

const PLAN_AR_LABELS: Record<string, string> = {
  silver: 'فضي',
  golden: 'ذهبي',
  king: 'ملكي',
};

const PLAN_HEADERS: string[] = ['فضي', 'ذهبي', 'ملكي'];

const PLAN_ROWS = [
  ['5 جهات اتصال', '30 جهة اتصال', 'غير محدود'],
  ['20 دولار', '30 دولار', '50 دولار'],
];

const PLAN_ORDER = ['silver', 'golden', 'king'];

const DEFAULT_PLANS: SubscriptionPlan[] = [
  { code: 'silver', name: 'Silver', yearly_discount_percent: 0 },
  { code: 'golden', name: 'Golden', yearly_discount_percent: 10 },
  { code: 'king', name: 'King', yearly_discount_percent: 15 },
];

const planLabel = (code?: string | null) => {
  if (!code) return '—';
  const normalized = code.toLowerCase();
  return PLAN_AR_LABELS[normalized] || code;
};

const planNameOrLabel = (plan?: { name?: string | null; code?: string | null }) => {
  if (!plan) return '—';
  if (plan.name && plan.name.trim()) {
    return plan.name.trim();
  }
  return planLabel(plan.code);
};

const normalizePlanCode = (code?: string | null, availablePlans?: SubscriptionPlan[]): PlanCode => {
  if (!code) {
    return availablePlans?.[0]?.code ?? 'silver';
  }
  const lower = code.toLowerCase();
  if (availablePlans) {
    const matched = availablePlans.find((plan) => plan.code?.toString().toLowerCase() === lower);
    if (matched?.code) {
      return matched.code;
    }
  }
  if (PLAN_ORDER.includes(lower)) {
    return lower as PlanCode;
  }
  return availablePlans?.[0]?.code ?? code;
};

const formatDateTimeEn = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso ?? '—';
  }
};

export default function SubscriptionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const isLight = mode === 'light';
  const isRTL = I18nManager.isRTL;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [overview, setOverview] = useState<SubscriptionOverviewResponse | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>(DEFAULT_PLANS);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>('silver');
  const [busy, setBusy] = useState(false);
  const [planSelectorVisible, setPlanSelectorVisible] = useState(false);

  const palette = useMemo(() => ({
    panelBg: isLight ? 'rgba(255,255,255,0.95)' : '#0f1b22',
    panelBorder: isLight ? '#f2cdaa' : '#233138',
    headerIcon: isLight ? '#f97316' : '#facc15',
    headerText: isLight ? '#1f2937' : '#e2e8f0',
    subText: isLight ? '#7f6958' : '#94a3b8',
    title: isLight ? '#3b2f24' : '#f8fafc',
    tableHeaderBg: isLight ? '#fff3e4' : 'rgba(255,255,255,0.08)',
    tableBorder: isLight ? '#f1c8a4' : '#233138',
    tableText: isLight ? '#3b3126' : '#e2e8f0',
    badgeBg: isLight ? '#fff4e0' : 'rgba(251,191,36,0.15)',
    badgeBorder: isLight ? '#f2cfae' : 'rgba(251,191,36,0.35)',
    badgeText: isLight ? '#8a6b44' : '#fcd34d',
    statusActive: isLight ? '#207650' : '#34d399',
    statusExpired: isLight ? '#d1433f' : '#f87171',
    statusNeutral: isLight ? '#9f8c7c' : '#94a3b8',
    cardBorder: isLight ? '#f1c8a4' : '#233138',
    cardBg: isLight ? '#fff9f1' : '#13222b',
    divider: isLight ? '#f3d8bb' : '#1f2d35',
    selectBg: isLight ? '#ffffff' : '#152430',
    selectBorder: isLight ? '#f1c59c' : '#233138',
    selectText: isLight ? '#423528' : '#f8fafc',
    modalBackdrop: 'rgba(0,0,0,0.45)',
    modalBg: isLight ? 'rgba(255,255,255,0.98)' : '#1a2731',
    modalBorder: isLight ? '#f2d5b6' : '#233138',
    modalOptionBg: isLight ? '#fff5e8' : '#22313c',
    modalOptionBorder: isLight ? '#f2cdaa' : '#1f2d35',
    buttonPrimaryBg: isLight ? '#2f9d73' : '#059669',
    buttonPrimaryText: '#ffffff',
    buttonSecondaryBg: isLight ? '#3d82f6' : '#2563eb',
    buttonSecondaryText: '#ffffff',
    buttonDisabledBg: isLight ? '#d1d5db' : '#374151',
    errorText: isLight ? '#d1433f' : '#f87171',
    infoText: isLight ? '#9a8878' : '#94a3b8',
  }), [isLight]);

  const sortedPlans = useMemo(() => {
    if (!plans.length) return DEFAULT_PLANS;
    const ranked = plans.map((plan) => {
      const lower = plan.code?.toString().toLowerCase() ?? '';
      const rank = PLAN_ORDER.indexOf(lower);
      return { plan, rank: rank === -1 ? 999 : rank };
    });
    return ranked.sort((a, b) => a.rank - b.rank).map(({ plan }) => plan);
  }, [plans]);

  const selectedPlanInfo = useMemo(() => {
    const lower = selectedPlan?.toString().toLowerCase();
    return plans.find((plan) => plan.code?.toString().toLowerCase() === lower) ?? null;
  }, [plans, selectedPlan]);

  const subscription = overview?.subscription ?? null;
  const pending = overview?.pending_request ?? null;

  const periodLabel = useMemo(() => {
    if (!subscription?.start_at || !subscription?.end_at) return '—';
    try {
      const start = new Date(subscription.start_at).getTime();
      const end = new Date(subscription.end_at).getTime();
      const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
      return days >= 200 ? 'سنوي' : 'شهري';
    } catch {
      return '—';
    }
  }, [subscription?.start_at, subscription?.end_at]);

  const remainingDays = useMemo(() => {
    if (!subscription?.end_at) return 0;
    try {
      const end = new Date(subscription.end_at).getTime();
      const now = Date.now();
      const diff = Math.floor((end - now) / (1000 * 60 * 60 * 24));
      return Math.max(0, diff);
    } catch {
      return 0;
    }
  }, [subscription?.end_at]);

  const statusBadge = useCallback((status?: string | null) => {
    if (!status) {
      return <Text style={[styles.statusText, { color: palette.statusNeutral }]}>غير معروف</Text>;
    }
    const normalized = status.toLowerCase();
    if (normalized === 'active') {
      return <Text style={[styles.statusText, { color: palette.statusActive }]}>نشط</Text>;
    }
    if (normalized === 'expired') {
      return <Text style={[styles.statusText, { color: palette.statusExpired }]}>منتهي</Text>;
    }
    if (normalized === 'cancelled') {
      return <Text style={[styles.statusText, { color: palette.statusNeutral }]}>ملغي</Text>;
    }
    return <Text style={[styles.statusText, { color: palette.statusNeutral }]}>{status}</Text>;
  }, [palette.statusActive, palette.statusExpired, palette.statusNeutral]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const [overviewData, plansData] = await Promise.all([
        fetchSubscriptionOverview(),
        fetchSubscriptionPlans().catch(() => DEFAULT_PLANS),
      ]);
      setOverview(overviewData);
      const availablePlans = (Array.isArray(plansData) && plansData.length ? plansData : DEFAULT_PLANS);
      setPlans(availablePlans);
      const currentCode = overviewData.subscription?.plan?.code;
      setSelectedPlan(normalizePlanCode(currentCode, availablePlans));
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        setAuthRequired(true);
      } else {
        const message = error instanceof Error ? error.message : 'تعذر تحميل البيانات';
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const handleRenew = useCallback(async (period: 'monthly' | 'yearly') => {
    if (pending || busy) {
      return;
    }
    setBusy(true);
    try {
      await renewSubscription(selectedPlan, period);
      Alert.alert('تم الإرسال', period === 'monthly' ? 'تم إنشاء طلب التجديد الشهري. سيتم مراجعته قريباً.' : 'تم إنشاء طلب التجديد السنوي. سيتم مراجعته قريباً.');
      await loadData();
    } catch (error) {
      const message = error instanceof HttpError
        ? (typeof error.payload === 'object' && error.payload && 'detail' in error.payload
          ? String((error.payload as Record<string, unknown>).detail)
          : error.message)
        : (error instanceof Error ? error.message : 'تعذر إنشاء الطلب');
      Alert.alert('تعذر إنشاء الطلب', message);
    } finally {
      setBusy(false);
    }
  }, [busy, loadData, pending, selectedPlan]);

  const openPlanSelector = useCallback(() => {
    if (busy || pending) return;
    setPlanSelectorVisible(true);
  }, [busy, pending]);

  const closePlanSelector = useCallback(() => {
    setPlanSelectorVisible(false);
  }, []);

  const handleSelectPlan = useCallback((code: PlanCode) => {
    setSelectedPlan(code);
    closePlanSelector();
  }, [closePlanSelector]);

  const renderPlanModal = () => (
    <Modal
      visible={planSelectorVisible}
      transparent
      animationType="fade"
      onRequestClose={closePlanSelector}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.modalOverlay} onPress={closePlanSelector} />
        <View style={[styles.modalContent, { backgroundColor: palette.modalBg, borderColor: palette.modalBorder }]}
        >
          <Text style={[styles.modalTitle, { color: palette.title }]}>اختر الباقة</Text>
          {sortedPlans.map((plan) => {
            const isSelected = plan.code === selectedPlan;
            return (
              <Pressable
                key={String(plan.code)}
                style={[styles.modalOption, {
                  flexDirection: isRTL ? 'row-reverse' : 'row',
                  backgroundColor: isSelected ? palette.modalOptionBg : 'transparent',
                  borderColor: palette.modalOptionBorder,
                }]}
                onPress={() => handleSelectPlan(plan.code)}
              >
                <Text style={[styles.modalOptionText, { color: palette.selectText }]}>
                  {planNameOrLabel(plan)}
                </Text>
                {isSelected && (
                  <FeatherIcon name="check" size={18} color={palette.headerIcon} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );

  const renderTable = () => (
    <View style={[styles.tableWrapper, { borderColor: palette.tableBorder }]}
    >
      <View style={[styles.tableHeader, { backgroundColor: palette.tableHeaderBg, borderColor: palette.tableBorder }]}
      >
        {PLAN_HEADERS.map((label) => (
          <View key={label} style={styles.tableCell}>
            <Text style={[styles.tableHeaderText, { color: palette.tableText }]}>{label}</Text>
          </View>
        ))}
      </View>
      {PLAN_ROWS.map((row, rowIndex) => (
        <View
          key={rowIndex}
          style={[styles.tableRow, {
            borderColor: palette.tableBorder,
          }]}
        >
          {row.map((value, cellIndex) => (
            <View key={cellIndex} style={[styles.tableCell, { borderColor: palette.tableBorder }]}
            >
              <Text style={[styles.tableCellText, { color: palette.tableText }]}>{value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  const renderContent = () => {
    if (authRequired) {
      return (
        <View style={[styles.messageCard, { borderColor: palette.cardBorder, backgroundColor: palette.panelBg }]}
        >
          <Text style={[styles.messageTitle, { color: palette.title }]}>الرجاء تسجيل الدخول أولاً</Text>
          <Text style={[styles.messageText, { color: palette.subText }]}>هذه الصفحة متاحة للمستخدمين المسجلين فقط.</Text>
        </View>
      );
    }

    if (loading) {
      return (
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={palette.headerIcon} />
          <Text style={[styles.loadingText, { color: palette.infoText }]}>جارٍ التحميل…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.loadingState}>
          <Text style={[styles.errorText, { color: palette.errorText }]}>{error}</Text>
        </View>
      );
    }

    const disabled = Boolean(pending) || busy;

    return (
      <View style={styles.contentStack}>
        {pending && (
          <View style={[styles.pendingBadge, {
            backgroundColor: palette.badgeBg,
            borderColor: palette.badgeBorder,
            flexDirection: isRTL ? 'row-reverse' : 'row',
          }]}
          >
            <View style={[styles.pendingDot, { backgroundColor: palette.headerIcon }]} />
            <Text style={[styles.pendingText, { color: palette.badgeText }]}>طلبك قيد المراجعة</Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
        >
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.subText }]}>الباقة الحالية</Text>
            <Text style={[styles.summaryValue, { color: palette.title }]}>{planNameOrLabel(subscription?.plan ?? undefined)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.subText }]}>نوع الاشتراك</Text>
            <Text style={[styles.summaryValue, { color: palette.title }]}>{periodLabel}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.subText }]}>تاريخ آخر اشتراك</Text>
            <Text style={[styles.summaryValue, { color: palette.title }]}>{formatDateTimeEn(subscription?.start_at)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.subText }]}>تاريخ الانتهاء</Text>
            <Text style={[styles.summaryValue, { color: palette.title }]}>{formatDateTimeEn(subscription?.end_at)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.subText }]}>الحالة</Text>
            {statusBadge(subscription?.status)}
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.subText }]}>الأيام المتبقية</Text>
            <Text style={[styles.summaryValue, { color: palette.title }]}>{remainingDays}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
        >
          <View style={[styles.upgradeHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            <Text style={[styles.upgradeLabel, { color: palette.subText }]}>ترقية الباقة</Text>
            <Pressable
              onPress={openPlanSelector}
              disabled={disabled}
              style={[styles.selectInput, {
                backgroundColor: palette.selectBg,
                borderColor: palette.selectBorder,
                flexDirection: isRTL ? 'row-reverse' : 'row',
                opacity: disabled ? 0.7 : 1,
              }]}
            >
              <Text style={[styles.selectText, { color: palette.selectText }]}>{planNameOrLabel(selectedPlanInfo ?? { code: selectedPlan })}</Text>
              <FeatherIcon name={isRTL ? 'chevron-left' : 'chevron-right'} size={18} color={palette.subText} />
            </Pressable>
          </View>
          <View style={[styles.buttonsRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
          >
            <Pressable
              onPress={() => handleRenew('monthly')}
              disabled={disabled}
              style={[styles.actionButton, {
                backgroundColor: disabled ? palette.buttonDisabledBg : palette.buttonPrimaryBg,
              }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.buttonPrimaryText} />
              ) : (
                <Text style={[styles.actionButtonText, { color: palette.buttonPrimaryText }]}>تجديد شهري</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => handleRenew('yearly')}
              disabled={disabled}
              style={[styles.actionButton, {
                backgroundColor: disabled ? palette.buttonDisabledBg : palette.buttonSecondaryBg,
              }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.buttonSecondaryText} />
              ) : (
                <View style={[styles.yearlyContent, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                >
                  <Text style={[styles.actionButtonText, { color: palette.buttonSecondaryText }]}>تجديد سنوي</Text>
                  {!!selectedPlanInfo?.yearly_discount_percent && (
                    <View style={[styles.discountBadge, { borderColor: palette.tableBorder }]}
                    >
                      <Text style={styles.discountText}>
                        خصم {selectedPlanInfo.yearly_discount_percent}%
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          </View>
        </View>
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
              <Text style={[styles.headerTitle, { color: palette.headerText }]}>الاشتراك</Text>
            </View>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.panel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}>
              {renderTable()}
              {renderContent()}
            </View>
          </ScrollView>
        </View>
        {renderPlanModal()}
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
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  tableWrapper: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tableCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  tableHeaderText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tableCellText: {
    fontSize: 12,
    fontWeight: '500',
  },
  contentStack: {
    gap: 16,
  },
  pendingBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 8,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pendingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
  },
  upgradeHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  upgradeLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  selectInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectText: {
    fontSize: 14,
    fontWeight: '600',
  },
  buttonsRow: {
    marginTop: 12,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  yearlyContent: {
    alignItems: 'center',
    gap: 10,
  },
  discountBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fcd34d',
  },
  discountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#854d0e',
  },
  loadingState: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  messageCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  messageTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  messageText: {
    fontSize: 13,
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 24,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalContent: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalOption: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalOptionText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
