import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  I18nManager,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { getNotificationSoundEnabled, setNotificationSoundEnabled } from '../lib/preferences';
import {
  disableTotp,
  enableTotp,
  fetchNotificationSoundUrl,
  fetchTotpStatus,
  setupTotp,
  type TotpStatus,
} from '../services/security';
import { clearAll, inspectState } from '../lib/pinSession';
import { fetchPinStatus } from '../services/pin';
import { fetchCurrentUser } from '../services/user';
import { getAccessToken, getRefreshToken, type AuthTokens } from '../lib/authStorage';
import {
  approvePendingDevice,
  fetchLinkedDevices,
  isDeviceActive,
  isDevicePending,
  rejectPendingDevice,
  renameDevice,
  replaceDevice,
  revokeDevice,
  type LinkedDevice,
  type DeviceStatus,
  HttpError,
} from '../services/devices';
import { getStoredDeviceId } from '../lib/deviceIdentity';
import { isQaBuild } from '../utils/qa';

const QR_SIZE = 180;
const SOUND_TEST_TIMEOUT_MS = 2500;

const DEVICE_STATUS_LABELS: Partial<Record<DeviceStatus, string>> = {
  primary: 'أساسي',
  active: 'نشط',
  pending: 'بانتظار الموافقة',
  revoked: 'ملغي',
};

function getDeviceStatusLabel(status: DeviceStatus): string {
  return DEVICE_STATUS_LABELS[status] ?? status;
}

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return 'لم يتم التحقق بعد';
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'تاريخ غير معروف';
  }
  const diffMs = Date.now() - timestamp.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'قبل لحظات';
  }
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `قبل ${minutes} دقيقة`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `قبل ${hours} ساعة`;
  }
  if (diffMs < 7 * day) {
    const days = Math.max(1, Math.floor(diffMs / day));
    return `قبل ${days} يوم`;
  }
  try {
    return timestamp.toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return timestamp.toLocaleDateString();
  }
}

function extractDeviceErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return 'لا تملك صلاحية تنفيذ هذا الإجراء.';
    }
    if (error.status === 404) {
      return 'لم يتم العثور على الجهاز المطلوب.';
    }
    if (typeof error.payload === 'string') {
      const trimmed = error.payload.trim();
      if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) {
        return 'تعذر تنفيذ الطلب. تحقّق من توفر واجهة الأجهزة.';
      }
      return trimmed;
    }
    if (error.payload && typeof error.payload === 'object') {
      const payload = error.payload as Record<string, unknown>;
      const detail = payload.detail;
      if (typeof detail === 'string' && detail.trim().length) {
        return detail;
      }
      const firstString = Object.values(payload).find((entry) => typeof entry === 'string');
      if (typeof firstString === 'string') {
        return firstString;
      }
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message || 'حدث خطأ غير متوقع.';
  }
  return 'حدث خطأ غير متوقع.';
}

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode, toggleTheme } = useThemeMode();
  const isLight = mode === 'light';
  const isRTL = I18nManager.isRTL;
  const qaEnabled = isQaBuild();
  const directionStyle = useMemo(() => (isRTL ? styles.rtlDirection : styles.ltrDirection), [isRTL]);
  const textDirectionStyle = useMemo(() => (isRTL ? styles.textAlignRight : styles.textAlignLeft), [isRTL]);

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [totpStatus, setTotpStatus] = useState<TotpStatus | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [otpUri, setOtpUri] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);

  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const [loadingSound, setLoadingSound] = useState(true);
  const [testingSound, setTestingSound] = useState(false);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

  const [pinState, setPinState] = useState<{ enabled: boolean; displayName?: string | null; username?: string | null } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesRefreshing, setDevicesRefreshing] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState<number>(3);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [renameState, setRenameState] = useState<{ device: LinkedDevice; value: string } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [replaceState, setReplaceState] = useState<{ pending: LinkedDevice } | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [replaceSaving, setReplaceSaving] = useState(false);
  const devicesPollRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const storedId = await getStoredDeviceId();
        if (!cancelled && isMountedRef.current) {
          setCurrentDeviceId(storedId);
        }
      } catch (error) {
        console.warn('[Mutabaka] Failed to read stored device id', error);
      }
    })();
    return () => {
      cancelled = true;
      isMountedRef.current = false;
      if (devicesPollRef.current) {
        clearInterval(devicesPollRef.current);
        devicesPollRef.current = null;
      }
    };
  }, []);

  const loadDevices = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!isMountedRef.current) {
      return;
    }
    if (mode === 'initial') {
      setDevicesLoading(true);
      setDevicesError(null);
    } else if (mode === 'refresh') {
      if (devicesRefreshing) {
        return;
      }
      setDevicesRefreshing(true);
      setDevicesError(null);
    }
    try {
      const response = await fetchLinkedDevices();
      if (!isMountedRef.current) {
        return;
      }
      setDevices(response.devices ?? []);
      setDeviceLimit(response.limit ?? 3);
      if (mode === 'initial') {
        setDevicesError(null);
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = extractDeviceErrorMessage(error);
      setDevicesError(message);
    } finally {
      if (!isMountedRef.current) {
        return;
      }
      if (mode === 'initial') {
        setDevicesLoading(false);
      }
      if (mode === 'refresh') {
        setDevicesRefreshing(false);
      }
    }
  }, [devicesRefreshing]);

  const handleManualDevicesRefresh = useCallback(() => {
    loadDevices('refresh').catch((error) => {
      console.warn('[Mutabaka] Failed to refresh devices', error);
    });
  }, [loadDevices]);

  const palette = useMemo(() => ({
    panelBg: isLight ? 'rgba(255,255,255,0.95)' : '#0f1b22',
    panelBorder: isLight ? '#f2cdaa' : '#233138',
    headerIcon: isLight ? '#f97316' : '#facc15',
    headerText: isLight ? '#1f2937' : '#e2e8f0',
    cardBg: isLight ? '#fff9f1' : '#13222b',
    cardBorder: isLight ? '#f1c8a4' : '#1f2d35',
    heading: isLight ? '#43382d' : '#e2e8f0',
    subText: isLight ? '#7f6958' : '#94a3b8',
    badgeActive: isLight ? '#1d7d53' : '#34d399',
    badgeInactive: isLight ? '#9a8778' : '#64748b',
    primaryButtonBg: isLight ? '#2f9d73' : '#059669',
    primaryButtonText: '#ffffff',
    neutralButtonBg: isLight ? '#f8ede1' : '#4b5563',
    neutralButtonText: isLight ? '#6b533d' : '#f9fafb',
    dangerButtonBg: isLight ? '#ef5350' : '#dc2626',
    dangerButtonText: '#ffffff',
    ghostButtonBg: isLight ? '#fff3e4' : 'rgba(255,255,255,0.12)',
    ghostButtonText: isLight ? '#6f563e' : '#f1f5f9',
    divider: isLight ? '#f2d5b6' : '#1f2d35',
    inputBg: isLight ? '#ffffff' : '#1a2731',
    inputBorder: isLight ? '#f1c59c' : '#1f2d35',
    inputText: isLight ? '#3d3227' : '#f8fafc',
    inputPlaceholder: isLight ? '#b29276' : '#64748b',
    pillBorder: isLight ? '#f1c8a4' : '#1f2d35',
  }), [isLight]);

  const loadTotp = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const status = await fetchTotpStatus();
      setTotpStatus(status);
      if (status.enabled) {
        setTotpSecret(null);
        setOtpUri(null);
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to load TOTP status', error);
      Alert.alert('تعذر التحميل', 'فشل تحميل حالة المصادقة الثنائية. حاول لاحقاً.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const refreshPinState = useCallback(async () => {
    try {
      const state = await inspectState();
      setPinState({
        enabled: state.hasSecureSession,
        displayName: state.metadata?.displayName ?? null,
        username: state.metadata?.username ?? null,
      });
    } catch (error) {
      console.warn('[Mutabaka] Failed to inspect PIN state', error);
      setPinState({ enabled: false });
    }
  }, []);

  const handleCreatePin = useCallback(async () => {
    if (pinBusy) {
      return;
    }
    setPinBusy(true);
    try {
      const [accessToken, refreshToken] = await Promise.all([getAccessToken(), getRefreshToken()]);
      if (!accessToken || !refreshToken) {
        Alert.alert('تعذر المتابعة', 'الرجاء تسجيل الدخول مرة أخرى لإنشاء رمز PIN.');
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      const tokens: AuthTokens = { accessToken, refreshToken };
      const [pinStatus, meInfo] = await Promise.all([
        fetchPinStatus(),
        fetchCurrentUser(),
      ]);
      navigation.navigate('PinSetup', {
        userId: meInfo.id,
        tokens,
        pinStatus,
        displayName: meInfo.display_name ?? meInfo.username,
        username: meInfo.username,
        mode: 'initial',
      });
    } catch (error) {
      console.warn('[Mutabaka] Failed to start PIN creation flow', error);
      Alert.alert('تعذر المتابعة', 'حدث خطأ أثناء التحضير لإنشاء رمز PIN. حاول مرة أخرى لاحقاً.');
    } finally {
      setPinBusy(false);
    }
  }, [navigation, pinBusy]);

  const loadSoundPreferences = useCallback(async () => {
    try {
      setLoadingSound(true);
      const [enabledValue, urlValue] = await Promise.all([
        getNotificationSoundEnabled(),
        fetchNotificationSoundUrl(),
      ]);
      setSoundEnabledState(enabledValue);
      setSoundUrl(urlValue);
    } catch (error) {
      console.warn('[Mutabaka] Failed to load sound preferences', error);
    } finally {
      setLoadingSound(false);
    }
  }, []);

  useEffect(() => {
    loadSoundPreferences();
  }, [loadSoundPreferences]);

  useFocusEffect(
    useCallback(() => {
      loadTotp();
      refreshPinState();
      loadDevices('initial').catch((error) => {
        console.warn('[Mutabaka] Failed to load devices', error);
      });
      if (devicesPollRef.current) {
        clearInterval(devicesPollRef.current);
      }
      devicesPollRef.current = setInterval(() => {
        loadDevices('silent').catch((error) => {
          console.warn('[Mutabaka] Failed to poll devices', error);
        });
      }, 15000);
      return () => {
        if (soundRef.current) {
          soundRef.current.unloadAsync().catch(() => undefined);
          soundRef.current = null;
        }
        if (devicesPollRef.current) {
          clearInterval(devicesPollRef.current);
          devicesPollRef.current = null;
        }
      };
    }, [loadTotp, refreshPinState, loadDevices]),
  );

  const handleSetupTotp = useCallback(async () => {
    setTotpBusy(true);
    try {
      const response = await setupTotp();
      setTotpSecret(response.secret);
      setOtpUri(response.otpauth_uri);
      setOtpInput('');
      setTotpStatus((prev) => (prev ? { ...prev, has_secret: true } : { enabled: false, has_secret: true }));
    } catch (error) {
      console.warn('[Mutabaka] Failed to setup TOTP', error);
      Alert.alert('تعذر الإنشاء', 'لم نتمكن من إنشاء مفتاح المصادقة.');
    } finally {
      setTotpBusy(false);
    }
  }, []);

  const handleChangePin = useCallback(() => {
    if (!pinState?.enabled) {
      Alert.alert('غير متاح', 'قم بتسجيل الدخول وتفعيل PIN أولًا.');
      return;
    }
    navigation.navigate('PinUnlock', {
      intent: 'change',
      displayName: pinState.displayName ?? pinState.username ?? undefined,
    });
  }, [navigation, pinState]);

  const handleDisablePin = useCallback(() => {
    if (!pinState?.enabled || pinBusy) {
      return;
    }
    Alert.alert(
      'إلغاء رمز PIN',
      'سيتم مسح الجلسة المشفرة من هذا الجهاز وإعادتك إلى شاشة تسجيل الدخول.',
      [
        { text: 'تراجع', style: 'cancel' },
        {
          text: 'إلغاء الرمز',
          style: 'destructive',
          onPress: () => {
            setPinBusy(true);
            (async () => {
              try {
                await clearAll();
                navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
              } catch (error) {
                console.warn('[Mutabaka] Failed to clear PIN session', error);
                Alert.alert('تعذر الإلغاء', 'حدث خطأ أثناء حذف الجلسة.');
              } finally {
                setPinBusy(false);
                refreshPinState();
              }
            })();
          },
        },
      ],
    );
  }, [navigation, pinBusy, pinState, refreshPinState]);

  const handleEnableTotp = useCallback(async () => {
    const code = otpInput.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      Alert.alert('رمز غير صالح', 'يرجى إدخال رمز مكون من 6 أرقام.');
      return;
    }
    setTotpBusy(true);
    try {
      await enableTotp(code);
      Alert.alert('تم التفعيل', 'تم تفعيل المصادقة الثنائية بنجاح.');
      setTotpSecret(null);
      setOtpUri(null);
      setOtpInput('');
      await loadTotp();
    } catch (error) {
      console.warn('[Mutabaka] Failed to enable TOTP', error);
      Alert.alert('تعذر التفعيل', 'تحقق من الرمز وحاول مرة أخرى.');
    } finally {
      setTotpBusy(false);
    }
  }, [loadTotp, otpInput]);

  const handleDisableTotp = useCallback(async () => {
    const code = otpInput.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      Alert.alert('رمز غير صالح', 'يرجى إدخال رمز مكون من 6 أرقام.');
      return;
    }
    setTotpBusy(true);
    try {
      await disableTotp(code);
      Alert.alert('تم الإيقاف', 'تم إلغاء تفعيل المصادقة الثنائية.');
      setOtpInput('');
      setTotpSecret(null);
      setOtpUri(null);
      await loadTotp();
    } catch (error) {
      console.warn('[Mutabaka] Failed to disable TOTP', error);
      Alert.alert('تعذر الإلغاء', 'تحقق من الرمز وأعد المحاولة.');
    } finally {
      setTotpBusy(false);
    }
  }, [loadTotp, otpInput]);

  const handleCopySecret = useCallback(async () => {
    if (!totpSecret) {
      return;
    }
    try {
      await Clipboard.setStringAsync(totpSecret);
      Alert.alert('تم النسخ', 'تم نسخ المفتاح إلى الحافظة.');
    } catch (error) {
      console.warn('[Mutabaka] Failed to copy secret', error);
      Alert.alert('تعذر النسخ', 'حدث خطأ أثناء النسخ إلى الحافظة.');
    }
  }, [totpSecret]);

  const handleToggleSound = useCallback(async () => {
    const next = !soundEnabled;
    setSoundEnabledState(next);
    await setNotificationSoundEnabled(next);
  }, [soundEnabled]);

  const handleTestSound = useCallback(async () => {
    if (!soundEnabled) {
      Alert.alert('الصوت متوقف', 'فعّل الصوت أولاً لتجربة التنبيه.');
      return;
    }
    if (!soundUrl) {
      Alert.alert('لا يوجد صوت', 'لم يتم ضبط صوت تنبيه من لوحة التحكم.');
      return;
    }
    if (testingSound) {
      return;
    }
    setTestingSound(true);
    try {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri: soundUrl }, { shouldPlay: false });
        soundRef.current = sound;
      }
      const sound = soundRef.current;
      if (!sound) {
        throw new Error('sound unavailable');
      }
      await sound.setPositionAsync(0);
      await sound.playAsync();
      await new Promise((resolve) => setTimeout(resolve, SOUND_TEST_TIMEOUT_MS));
      await sound.stopAsync().catch(() => undefined);
    } catch (error) {
      console.warn('[Mutabaka] Failed to play notification sound', error);
      Alert.alert('تعذر التشغيل', 'لم نتمكن من تشغيل صوت التنبيه.');
    } finally {
      setTestingSound(false);
    }
  }, [soundEnabled, soundUrl, testingSound]);

  const handlePushEnable = useCallback(() => {
    Alert.alert('غير متاح حالياً', 'إشعارات الويب غير مدعومة في تطبيق الجوال بعد.');
  }, []);

  const handlePushDisable = useCallback(() => {
    Alert.alert('غير متاح حالياً', 'إشعارات الويب غير مدعومة في تطبيق الجوال بعد.');
  }, []);

  const renderBadge = (text: string, active: boolean) => (
    <Text
      style={[
        styles.badge,
        textDirectionStyle,
        {
          color: active ? palette.badgeActive : palette.badgeInactive,
          alignSelf: isRTL ? 'flex-end' : 'flex-start',
        },
      ]}
    >
      {text}
    </Text>
  );

  const activeDevices = useMemo(() => devices.filter((item) => isDeviceActive(item.status)), [devices]);
  const pendingDevices = useMemo(() => devices.filter((item) => isDevicePending(item.status)), [devices]);
  const actingDevice = useMemo(() => devices.find((item) => item.device_id === currentDeviceId) ?? null, [devices, currentDeviceId]);
  const actingIsPrimary = actingDevice?.status === 'primary';
  const replaceCandidates = useMemo(
    () => activeDevices.filter((device) => device.status !== 'primary' && device.device_id !== currentDeviceId),
    [activeDevices, currentDeviceId],
  );
  const deviceUsageText = `${activeDevices.length}/${deviceLimit}`;

  const handleOpenQaDevices = useCallback(() => {
    navigation.navigate('QADevices');
  }, [navigation]);

  const handleApproveDevice = useCallback(
    (device: LinkedDevice) => {
      if (!actingIsPrimary) {
        Alert.alert('غير مسموح', 'فقط الجهاز الأساسي يمكنه الموافقة على الأجهزة الجديدة.');
        return;
      }
      if (activeDevices.length >= deviceLimit) {
        setReplaceState({ pending: device });
        const defaultTarget = replaceCandidates[0]?.device_id ?? null;
        setReplaceTargetId(defaultTarget);
        setPendingActionId(`approve:${device.device_id}`);
        return;
      }
      setPendingActionId(`approve:${device.device_id}`);
      approvePendingDevice({ pendingDeviceId: device.device_id })
        .then(async () => {
          Alert.alert('تمت الموافقة', 'تم تفعيل الجهاز بنجاح.');
          await loadDevices('silent');
        })
        .catch((error) => {
          Alert.alert('تعذر الموافقة', extractDeviceErrorMessage(error));
        })
        .finally(() => {
          if (isMountedRef.current) {
            setPendingActionId(null);
          }
        });
    },
    [actingIsPrimary, activeDevices.length, deviceLimit, replaceCandidates, loadDevices],
  );

  const executeRejectDevice = useCallback(
    async (device: LinkedDevice) => {
      setPendingActionId(`reject:${device.device_id}`);
      try {
        await rejectPendingDevice({ deviceId: device.device_id });
        Alert.alert('تم الرفض', 'تم رفض الطلب المعلّق.');
        await loadDevices('silent');
      } catch (error) {
        Alert.alert('تعذر الرفض', extractDeviceErrorMessage(error));
      } finally {
        if (isMountedRef.current) {
          setPendingActionId(null);
        }
      }
    },
    [loadDevices],
  );

  const handleRejectDevice = useCallback(
    (device: LinkedDevice) => {
      if (!actingIsPrimary) {
        Alert.alert('غير مسموح', 'فقط الجهاز الأساسي يمكنه رفض الطلبات.');
        return;
      }
      Alert.alert('تأكيد الرفض', `هل تريد رفض طلب الجهاز "${device.label}"؟`, [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'رفض',
          style: 'destructive',
          onPress: () => {
            executeRejectDevice(device).catch((error) => {
              console.warn('[Mutabaka] Failed to reject device', error);
            });
          },
        },
      ]);
    },
    [actingIsPrimary, executeRejectDevice],
  );

  const executeRevokeDevice = useCallback(
    async (device: LinkedDevice) => {
      setPendingActionId(`revoke:${device.device_id}`);
      try {
        await revokeDevice({ deviceId: device.device_id });
        Alert.alert('تم الإلغاء', 'تم تعطيل الجهاز فورًا.');
        if (device.device_id === currentDeviceId) {
          await clearAll();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        await loadDevices('silent');
      } catch (error) {
        Alert.alert('تعذر الإلغاء', extractDeviceErrorMessage(error));
      } finally {
        if (isMountedRef.current) {
          setPendingActionId(null);
        }
      }
    },
    [currentDeviceId, loadDevices, navigation],
  );

  const handleRevokeDevice = useCallback(
    (device: LinkedDevice) => {
      if (!actingIsPrimary) {
        Alert.alert('غير مسموح', 'فقط الجهاز الأساسي يمكنه إلغاء الأجهزة.');
        return;
      }
      if (device.status === 'primary') {
        Alert.alert('غير ممكن', 'لا يمكن إلغاء الجهاز الأساسي.');
        return;
      }
      if (device.device_id === currentDeviceId) {
        Alert.alert('غير ممكن', 'لا يمكن للجهاز إلغاء نفسه من هنا.');
        return;
      }
      Alert.alert('تأكيد الإلغاء', `سيتم إلغاء تفعيل الجهاز "${device.label}" فورًا.`, [
        { text: 'تراجع', style: 'cancel' },
        {
          text: 'إلغاء التفعيل',
          style: 'destructive',
          onPress: () => {
            executeRevokeDevice(device).catch((error) => {
              console.warn('[Mutabaka] Failed to revoke device', error);
            });
          },
        },
      ]);
    },
    [actingIsPrimary, currentDeviceId, executeRevokeDevice],
  );

  const handleRenameDevice = useCallback(
    (device: LinkedDevice) => {
      if (!actingIsPrimary && device.device_id !== currentDeviceId) {
        Alert.alert('غير مسموح', 'لا يمكن تغيير اسم هذا الجهاز إلا من الجهاز الأساسي.');
        return;
      }
      setRenameState({ device, value: device.label });
    },
    [actingIsPrimary, currentDeviceId],
  );

  const handleRenameValueChange = useCallback((value: string) => {
    setRenameState((prev) => (prev ? { ...prev, value } : prev));
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameState) {
      return;
    }
    const trimmed = renameState.value.trim();
    if (!trimmed.length) {
      Alert.alert('اسم غير صالح', 'يرجى إدخال اسم للجهاز.');
      return;
    }
    setRenameSaving(true);
    try {
      await renameDevice({ deviceId: renameState.device.device_id, label: trimmed });
      Alert.alert('تم التحديث', 'تم تحديث اسم الجهاز بنجاح.');
      setRenameState(null);
      await loadDevices('silent');
    } catch (error) {
      Alert.alert('تعذر التحديث', extractDeviceErrorMessage(error));
    } finally {
      if (isMountedRef.current) {
        setRenameSaving(false);
      }
    }
  }, [renameState, loadDevices]);

  const handleCancelRename = useCallback(() => {
    setRenameState(null);
    setRenameSaving(false);
  }, []);

  const handleConfirmReplace = useCallback(async () => {
    if (!replaceState) {
      return;
    }
    if (!replaceTargetId) {
      Alert.alert('اختر جهازًا', 'يرجى اختيار الجهاز الذي سيتم استبداله.');
      return;
    }
    setReplaceSaving(true);
    try {
      await replaceDevice({
        pendingDeviceId: replaceState.pending.device_id,
        replaceDeviceId: replaceTargetId,
      });
      Alert.alert('تم الاستبدال', 'تمت الموافقة على الجهاز الجديد بعد استبدال أحد الأجهزة الحالية.');
      setReplaceState(null);
      setReplaceTargetId(null);
      await loadDevices('silent');
    } catch (error) {
      Alert.alert('تعذر الاستبدال', extractDeviceErrorMessage(error));
    } finally {
      if (isMountedRef.current) {
        setReplaceSaving(false);
        setPendingActionId(null);
      }
    }
  }, [replaceState, replaceTargetId, loadDevices]);

  const handleCancelReplace = useCallback(() => {
    setReplaceState(null);
    setReplaceTargetId(null);
    setReplaceSaving(false);
    setPendingActionId(null);
  }, []);

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View
            style={[
              styles.header,
              {
                backgroundColor: palette.panelBg,
                borderColor: palette.panelBorder,
                flexDirection: isRTL ? 'row-reverse' : 'row',
              },
            ]}
            accessibilityRole="header"
          >
            <View style={[styles.headerTitleGroup, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
            >
              <Pressable
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="رجوع"
                onPress={() => navigation.goBack()}
              >
                <FeatherIcon name={isRTL ? 'chevron-left' : 'chevron-right'} size={22} color={palette.headerIcon} />
              </Pressable>
              <Text style={[styles.headerTitle, textDirectionStyle, { color: palette.headerText }]}>الإعدادات</Text>
            </View>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.panel, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
            >
              <View style={styles.cardsContainer}>
                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardHeader, { flexDirection: 'column', alignItems: 'flex-end' }]}
                  >
                    <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                    >
                      <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>الوصول السريع برمز PIN</Text>
                      <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>إدارة رمز PIN المحلي لهذا الجهاز لتسجيل الدخول السريع.</Text>
                      {renderBadge(pinState?.enabled ? 'مفعّل' : 'غير مفعّل', Boolean(pinState?.enabled))}
                    </View>
                    <View style={[styles.buttonStack, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                    >
                      {pinState?.enabled ? (
                        <>
                          <Pressable
                            style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg, opacity: pinBusy ? 0.6 : 1 }]}
                            onPress={handleChangePin}
                            disabled={!pinState?.enabled || pinBusy}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>تغيير PIN</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.ghostButton, { backgroundColor: palette.ghostButtonBg, borderColor: palette.pillBorder, opacity: pinBusy ? 0.6 : 1 }]}
                            onPress={handleDisablePin}
                            disabled={!pinState?.enabled || pinBusy}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.buttonText, { color: palette.ghostButtonText }]}>إلغاء على هذا الجهاز</Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg, opacity: pinBusy ? 0.6 : 1, minWidth: 160 }]}
                          onPress={handleCreatePin}
                          disabled={pinBusy}
                          accessibilityRole="button"
                        >
                          {pinBusy ? (
                            <ActivityIndicator size="small" color={palette.primaryButtonText} />
                          ) : (
                            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>إنشاء PIN</Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                  </View>
                  {pinState?.enabled ? (
                    <View style={[styles.pinMetaRow, { borderColor: palette.divider, flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                    >
                      <Text style={[styles.pinMetaText, textDirectionStyle, { color: palette.subText }]}>مفعّل لحساب {pinState.displayName || pinState.username || 'الحالي'}.</Text>
                    </View>
                  ) : (
                    <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>لتمكين الوصول السريع، أنشئ رمز PIN لهذا الجهاز.</Text>
                  )}
                </View>

                {qaEnabled ? (
                  <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                  >
                    <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                    >
                      <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                      >
                        <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>وضع QA للأجهزة</Text>
                        <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>افتح شاشة اختبار الأجهزة لعمليات الموافقة، الاستبدال، الإلغاء السريع.</Text>
                      </View>
                      <Pressable
                        style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                        onPress={handleOpenQaDevices}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>فتح شاشة QA</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardHeader, { flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'flex-start' }]}
                  >
                    <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                    >
                      <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>الأجهزة المرتبطة</Text>
                      <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>تحكم بالأجهزة التي يمكنها الوصول إلى حسابك، ووافق على الأجهزة الجديدة أو أزل الأجهزة القديمة.</Text>
                      <Text style={[styles.deviceUsageText, textDirectionStyle, { color: palette.subText }]}>الاستخدام: {deviceUsageText}</Text>
                    </View>
                    <View style={[styles.cardActions, { alignItems: 'flex-end' }]}
                    >
                      <Pressable
                        style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg, opacity: devicesRefreshing ? 0.6 : 1 }]}
                        onPress={handleManualDevicesRefresh}
                        disabled={devicesRefreshing}
                        accessibilityRole="button"
                      >
                        {devicesRefreshing ? (
                          <ActivityIndicator size="small" color={palette.primaryButtonText} />
                        ) : (
                          <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>تحديث</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>

                  {devicesError ? (
                    <Text style={[styles.deviceErrorText, textDirectionStyle, { color: palette.dangerButtonBg }]}>{devicesError}</Text>
                  ) : null}

                  {devicesLoading ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color={palette.headerIcon} />
                      <Text style={[styles.loadingText, textDirectionStyle, { color: palette.subText }]}>جاري تحميل قائمة الأجهزة…</Text>
                    </View>
                  ) : (
                    <View style={styles.deviceSections}>
                      <View style={styles.deviceSection}>
                        <Text style={[styles.deviceSectionTitle, textDirectionStyle, { color: palette.heading }]}>الأجهزة الحالية</Text>
                        {activeDevices.length === 0 ? (
                          <Text style={[styles.deviceEmptyText, textDirectionStyle, { color: palette.subText }]}>لا توجد أجهزة نشطة حتى الآن.</Text>
                        ) : (
                          activeDevices.map((device) => {
                            const isPrimary = device.status === 'primary';
                            const isCurrent = device.device_id === currentDeviceId;
                            const revokeBusy = pendingActionId === `revoke:${device.device_id}`;
                            const canRename = actingIsPrimary || isCurrent;
                            const renameDisabled = !canRename;
                            return (
                              <View key={device.device_id} style={[styles.deviceRow, { borderColor: palette.divider, backgroundColor: palette.panelBg }]}
                              >
                                <View style={styles.deviceHeaderRow}>
                                  <Text style={[styles.deviceLabel, textDirectionStyle, { color: palette.heading }]} numberOfLines={1}>{device.label || 'جهاز بدون اسم'}</Text>
                                  <View style={[styles.deviceBadgesRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                                  >
                                    <Text style={[styles.deviceStatus, textDirectionStyle, { color: palette.badgeActive }]}>{getDeviceStatusLabel(device.status)}</Text>
                                    {isPrimary ? (
                                      <Text style={[styles.deviceTag, { borderColor: palette.pillBorder, color: palette.subText }]}>الجهاز الأساسي</Text>
                                    ) : null}
                                    {isCurrent ? (
                                      <Text style={[styles.deviceTag, { borderColor: palette.pillBorder, color: palette.subText }]}>هذا الجهاز</Text>
                                    ) : null}
                                  </View>
                                </View>
                                <Text style={[styles.deviceMeta, textDirectionStyle, { color: palette.subText }]}> 
                                  المنصة: {device.platform || 'غير معروفة'} • الإصدار: {device.app_version || 'غير محدد'}
                                </Text>
                                <Text style={[styles.deviceMeta, textDirectionStyle, { color: palette.subText }]}> 
                                  آخر نشاط: {formatRelativeTime(device.last_seen_at)}
                                </Text>
                                <View style={[styles.deviceActionsRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                                >
                                  <Pressable
                                    style={[
                                      styles.deviceActionButton,
                                      {
                                        borderColor: palette.pillBorder,
                                        backgroundColor: palette.ghostButtonBg,
                                        opacity: renameDisabled ? 0.6 : 1,
                                      },
                                    ]}
                                    onPress={() => handleRenameDevice(device)}
                                    accessibilityRole="button"
                                    disabled={renameDisabled}
                                  >
                                    <Text style={[styles.deviceActionText, { color: palette.ghostButtonText }]}>تغيير الاسم</Text>
                                  </Pressable>
                                  {actingIsPrimary && !isPrimary && !isCurrent ? (
                                    <Pressable
                                      style={[styles.deviceActionButton, { borderColor: palette.dangerButtonBg, backgroundColor: palette.dangerButtonBg, opacity: revokeBusy ? 0.6 : 1 }]}
                                      onPress={() => handleRevokeDevice(device)}
                                      accessibilityRole="button"
                                      disabled={revokeBusy}
                                    >
                                      {revokeBusy ? (
                                        <ActivityIndicator size="small" color={palette.dangerButtonText} />
                                      ) : (
                                        <Text style={[styles.deviceActionText, { color: palette.dangerButtonText }]}>إلغاء التفعيل</Text>
                                      )}
                                    </Pressable>
                                  ) : null}
                                </View>
                              </View>
                            );
                          })
                        )}
                      </View>

                      <View style={styles.deviceSection}>
                        <Text style={[styles.deviceSectionTitle, textDirectionStyle, { color: palette.heading }]}>طلبات معلّقة</Text>
                        {pendingDevices.length === 0 ? (
                          <Text style={[styles.deviceEmptyText, textDirectionStyle, { color: palette.subText }]}>لا توجد طلبات موافقة حالياً.</Text>
                        ) : (
                          pendingDevices.map((device) => {
                            const approveBusy = pendingActionId === `approve:${device.device_id}`;
                            const rejectBusy = pendingActionId === `reject:${device.device_id}`;
                            const waitingForReplace = replaceState?.pending.device_id === device.device_id;
                            return (
                              <View key={`pending-${device.device_id}`} style={[styles.deviceRow, { borderColor: palette.divider, backgroundColor: palette.panelBg }]}
                              >
                                <View style={styles.deviceHeaderRow}>
                                  <Text style={[styles.deviceLabel, textDirectionStyle, { color: palette.heading }]} numberOfLines={1}>{device.label || 'جهاز جديد'}</Text>
                                  <View style={[styles.deviceBadgesRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                                  >
                                    <Text style={[styles.deviceStatus, textDirectionStyle, { color: palette.badgeInactive }]}>بانتظار الموافقة</Text>
                                    {device.requires_replace || activeDevices.length >= deviceLimit ? (
                                      <Text style={[styles.deviceTag, { borderColor: palette.dangerButtonBg, color: palette.dangerButtonBg }]}>يتطلب استبدال</Text>
                                    ) : null}
                                  </View>
                                </View>
                                <Text style={[styles.deviceMeta, textDirectionStyle, { color: palette.subText }]}> 
                                  أنشئ: {formatRelativeTime(device.created_at)} • ينتهي: {formatRelativeTime(device.pending_expires_at)}
                                </Text>
                                <View style={[styles.deviceActionsRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                                >
                                  <Pressable
                                    style={[
                                      styles.deviceActionButton,
                                      {
                                        borderColor: palette.primaryButtonBg,
                                        backgroundColor: palette.primaryButtonBg,
                                        opacity: approveBusy || !actingIsPrimary ? 0.6 : 1,
                                      },
                                    ]}
                                    onPress={() => handleApproveDevice(device)}
                                    accessibilityRole="button"
                                    disabled={approveBusy || !actingIsPrimary}
                                  >
                                    {approveBusy ? (
                                      <ActivityIndicator size="small" color={palette.primaryButtonText} />
                                    ) : (
                                      <Text style={[styles.deviceActionText, { color: palette.primaryButtonText }]}>
                                        {actingIsPrimary ? 'موافقة' : 'طلب من الجهاز الأساسي'}
                                      </Text>
                                    )}
                                  </Pressable>
                                  <Pressable
                                    style={[
                                      styles.deviceActionButton,
                                      {
                                        borderColor: palette.dangerButtonBg,
                                        backgroundColor: palette.dangerButtonBg,
                                        opacity: rejectBusy || !actingIsPrimary ? 0.6 : 1,
                                      },
                                    ]}
                                    onPress={() => handleRejectDevice(device)}
                                    accessibilityRole="button"
                                    disabled={rejectBusy || !actingIsPrimary}
                                  >
                                    {rejectBusy ? (
                                      <ActivityIndicator size="small" color={palette.dangerButtonText} />
                                    ) : (
                                      <Text style={[styles.deviceActionText, { color: palette.dangerButtonText }]}>رفض</Text>
                                    )}
                                  </Pressable>
                                </View>
                                {waitingForReplace ? (
                                  <Text style={[styles.deviceMeta, textDirectionStyle, { color: palette.subText }]}>اختر الجهاز الذي سيتم استبداله لإكمال الموافقة.</Text>
                                ) : null}
                              </View>
                            );
                          })
                        )}
                      </View>
                    </View>
                  )}
                </View>

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                    >
                      <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>الأمان: المصادقة الثنائية (TOTP)</Text>
                      <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>تعمل مع Google Authenticator أو تطبيقات مشابهة.</Text>
                      {renderBadge(totpStatus?.enabled ? 'مفعّلة' : 'غير مفعّلة', Boolean(totpStatus?.enabled))}
                    </View>
                    <View style={styles.cardActions}>
                      {!totpStatus?.enabled ? (
                        <Pressable
                          style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                          onPress={handleSetupTotp}
                          disabled={totpBusy}
                          accessibilityRole="button"
                        >
                          {totpBusy ? (
                            <ActivityIndicator size="small" color={palette.primaryButtonText} />
                          ) : (
                            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>إنشاء مفتاح وQR</Text>
                          )}
                        </Pressable>
                      ) : (
                        <View style={[styles.inlineRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                        >
                          <TextInput
                            value={otpInput}
                            onChangeText={setOtpInput}
                            placeholder="رمز 6 أرقام"
                            keyboardType="number-pad"
                            maxLength={6}
                            style={[
                              styles.input,
                              {
                                backgroundColor: palette.inputBg,
                                borderColor: palette.inputBorder,
                                color: palette.inputText,
                                textAlign: 'center',
                              },
                            ]}
                            placeholderTextColor={palette.inputPlaceholder}
                          />
                          <Pressable
                            style={[styles.dangerButton, { backgroundColor: palette.dangerButtonBg }]}
                            onPress={handleDisableTotp}
                            disabled={totpBusy}
                            accessibilityRole="button"
                          >
                            {totpBusy ? (
                              <ActivityIndicator size="small" color={palette.dangerButtonText} />
                            ) : (
                              <Text style={[styles.buttonText, { color: palette.dangerButtonText }]}>إلغاء التفعيل</Text>
                            )}
                          </Pressable>
                        </View>
                      )}
                    </View>
                  </View>

                  {(otpUri || totpSecret) && !totpStatus?.enabled ? (
                    <View style={[styles.totpDetails, { borderColor: palette.divider }]}
                    >
                      <View style={[styles.qrWrapper, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
                      >
                        {otpUri ? (
                          <Image
                            source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&data=${encodeURIComponent(otpUri)}` }}
                            style={{ width: QR_SIZE, height: QR_SIZE }}
                          />
                        ) : null}
                      </View>
                      <View style={styles.totpInfo}>
                        <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>Secret:</Text>
                        <View style={[styles.secretRow, { flexDirection: isRTL ? 'row-reverse' : 'row', borderColor: palette.pillBorder }]}
                        >
                          <Text style={[styles.secretText, textDirectionStyle, { color: palette.heading }]} numberOfLines={2}>{totpSecret}</Text>
                          <Pressable style={[styles.copyButton, { backgroundColor: palette.ghostButtonBg, borderColor: palette.pillBorder }]}
                            onPress={handleCopySecret}
                            accessibilityRole="button"
                          >
                            <Text style={[styles.copyText, { color: palette.ghostButtonText }]}>نسخ</Text>
                          </Pressable>
                        </View>
                        <View style={[styles.inlineRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                        >
                          <TextInput
                            value={otpInput}
                            onChangeText={setOtpInput}
                            placeholder="أدخل رمز 6 أرقام"
                            keyboardType="number-pad"
                            maxLength={6}
                            style={[
                              styles.input,
                              {
                                backgroundColor: palette.inputBg,
                                borderColor: palette.inputBorder,
                                color: palette.inputText,
                                textAlign: 'center',
                              },
                            ]}
                            placeholderTextColor={palette.inputPlaceholder}
                          />
                          <Pressable
                            style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                            onPress={handleEnableTotp}
                            disabled={totpBusy}
                            accessibilityRole="button"
                          >
                            {totpBusy ? (
                              <ActivityIndicator size="small" color={palette.primaryButtonText} />
                            ) : (
                              <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>تفعيل</Text>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {loadingStatus ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color={palette.headerIcon} />
                      <Text style={[styles.loadingText, textDirectionStyle, { color: palette.subText }]}>جاري التحميل…</Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                    >
                      <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>المظهر</Text>
                      <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>بدّل بين الوضعين الفاتح والداكن عبر التطبيق.</Text>
                    </View>
                    <Pressable
                      style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                      onPress={toggleTheme}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
                        {isLight ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'flex-start' }]}
                  >
                    <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                    >
                      <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>تشغيل صوت الإشعار</Text>
                      <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>عند وصول رسالة جديدة والتطبيق في الخلفية أو في محادثة أخرى.</Text>
                    </View>
                    <View style={styles.soundActions}>
                      <Pressable
                        style={[styles.primaryButton, { backgroundColor: soundEnabled ? palette.primaryButtonBg : palette.neutralButtonBg }]}
                        onPress={handleToggleSound}
                        accessibilityRole="button"
                        disabled={loadingSound}
                      >
                        {loadingSound ? (
                          <ActivityIndicator size="small" color={palette.primaryButtonText} />
                        ) : (
                          <Text style={[styles.buttonText, { color: soundEnabled ? palette.primaryButtonText : palette.neutralButtonText }]}>
                            {soundEnabled ? 'مفعّل' : 'متوقف'}
                          </Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.ghostButton, { backgroundColor: palette.ghostButtonBg, borderColor: palette.pillBorder }]}
                        onPress={handleTestSound}
                        accessibilityRole="button"
                        disabled={loadingSound || testingSound}
                      >
                        {testingSound ? (
                          <ActivityIndicator size="small" color={palette.ghostButtonText} />
                        ) : (
                          <Text style={[styles.buttonText, { color: palette.ghostButtonText }]}>تجربة الصوت</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                </View>

                {/* Web Push - مخفي في الموبايل لأنه مخصص للويب فقط */}
                {/* Native Push Notifications يعمل تلقائياً في الخلفية */}
                {Platform.OS === 'web' && (
                  <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                  >
                    <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                    >
                      <View style={[styles.cardHeaderText, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}
                      >
                        <Text style={[styles.cardTitle, textDirectionStyle, { color: palette.heading }]}>إشعارات الرسائل (Web Push)</Text>
                        <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>الميزة مخصصة لإصدار الويب. سنضيف دعماً كاملاً لتطبيق الجوال لاحقاً.</Text>
                      </View>
                      {pushSupported ? (
                        <Pressable
                          style={[styles.primaryButton, { backgroundColor: pushEnabled ? palette.dangerButtonBg : palette.primaryButtonBg }]}
                          onPress={pushEnabled ? handlePushDisable : handlePushEnable}
                          accessibilityRole="button"
                          disabled={pushBusy}
                        >
                          {pushBusy ? (
                            <ActivityIndicator size="small" color={palette.primaryButtonText} />
                          ) : (
                            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
                              {pushEnabled ? 'إيقاف' : 'تفعيل'}
                            </Text>
                          )}
                        </Pressable>
                      ) : (
                        <Text style={[styles.cardSubtitle, textDirectionStyle, { color: palette.subText }]}>الميزة غير متاحة حالياً على هذا الجهاز.</Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
        {renameState ? (
          <Modal
            transparent
            animationType="fade"
            visible
            onRequestClose={handleCancelRename}
          >
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
              >
                <Text style={[styles.modalTitle, textDirectionStyle, { color: palette.heading }]}>تغيير اسم الجهاز</Text>
                <Text style={[styles.modalSubtitle, textDirectionStyle, { color: palette.subText }]}
                >
                  حدّث اسم الجهاز ليكون واضحًا، مثل "هاتف المكتب" أو "جهاز أحمد الشخصي".
                </Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.inputText }]}
                  value={renameState.value}
                  onChangeText={handleRenameValueChange}
                  placeholder="أدخل اسم الجهاز"
                  placeholderTextColor={palette.inputPlaceholder}
                  editable={!renameSaving}
                  maxLength={120}
                  autoFocus
                />
                <View style={[styles.modalButtons, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                >
                  <Pressable
                    style={[styles.modalButton, { backgroundColor: palette.ghostButtonBg, borderColor: palette.pillBorder, borderWidth: 1 }]}
                    onPress={handleCancelRename}
                    disabled={renameSaving}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.buttonText, { color: palette.ghostButtonText }]}>إلغاء</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalButton, { backgroundColor: palette.primaryButtonBg, opacity: renameSaving ? 0.6 : 1 }]}
                    onPress={handleRenameSubmit}
                    disabled={renameSaving}
                    accessibilityRole="button"
                  >
                    {renameSaving ? (
                      <ActivityIndicator size="small" color={palette.primaryButtonText} />
                    ) : (
                      <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>حفظ</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {replaceState ? (
          <Modal
            transparent
            animationType="fade"
            visible
            onRequestClose={handleCancelReplace}
          >
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, { backgroundColor: palette.panelBg, borderColor: palette.panelBorder }]}
              >
                <Text style={[styles.modalTitle, textDirectionStyle, { color: palette.heading }]}>استبدال جهاز للموافقة</Text>
                <Text style={[styles.modalSubtitle, textDirectionStyle, { color: palette.subText }]}
                >
                  لقد وصلت إلى الحد الأقصى للأجهزة ({deviceLimit}). اختر جهازًا لاستبداله بالجهاز الجديد "{replaceState.pending.label || 'جهاز جديد'}".
                </Text>
                <View style={styles.replaceList}>
                  {replaceCandidates.length === 0 ? (
                    <Text style={[styles.deviceEmptyText, textDirectionStyle, { color: palette.subText }]}>لا توجد أجهزة يمكن استبدالها. أزل جهازًا يدويًا أو اطلب من المسؤول زيادة الحد.</Text>
                  ) : (
                    replaceCandidates.map((device) => {
                      const isSelected = replaceTargetId === device.device_id;
                      return (
                        <Pressable
                          key={`replace-${device.device_id}`}
                          style={[
                            styles.replaceOption,
                            { borderColor: palette.pillBorder, backgroundColor: palette.cardBg },
                            isSelected ? [styles.replaceOptionActive, { borderColor: palette.primaryButtonBg }] : null,
                          ]}
                          onPress={() => setReplaceTargetId(device.device_id)}
                          accessibilityRole="button"
                        >
                          <View style={[styles.replaceOptionHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                          >
                            <Text style={[styles.replaceOptionTitle, textDirectionStyle, { color: palette.heading }]}>{device.label || 'جهاز بدون اسم'}</Text>
                            {device.status === 'primary' ? (
                              <Text style={[styles.replaceOptionBadge, { borderColor: palette.pillBorder, color: palette.subText }]}>أساسي</Text>
                            ) : null}
                          </View>
                          <Text style={[styles.replaceOptionMeta, textDirectionStyle, { color: palette.subText }]}
                          >
                            آخر نشاط: {formatRelativeTime(device.last_seen_at)}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
                <View style={[styles.modalButtons, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                >
                  <Pressable
                    style={[styles.modalButton, { backgroundColor: palette.ghostButtonBg, borderColor: palette.pillBorder, borderWidth: 1 }]}
                    onPress={handleCancelReplace}
                    disabled={replaceSaving}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.buttonText, { color: palette.ghostButtonText }]}>إلغاء</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.modalButton,
                      {
                        backgroundColor: palette.primaryButtonBg,
                        opacity: replaceSaving || !replaceTargetId ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleConfirmReplace}
                    disabled={replaceSaving || !replaceTargetId}
                    accessibilityRole="button"
                  >
                    {replaceSaving ? (
                      <ActivityIndicator size="small" color={palette.primaryButtonText} />
                    ) : (
                      <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>استبدال والموافقة</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}
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
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: {
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  rtlDirection: {
    writingDirection: 'rtl',
  },
  ltrDirection: {
    writingDirection: 'ltr',
  },
  textAlignRight: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  textAlignLeft: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  panel: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  cardsContainer: {
    gap: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 12,
  },
  buttonStack: {
    gap: 8,
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexWrap: 'wrap',
  },
  cardHeaderText: {
    flex: 1,
    gap: 4,
    alignSelf: 'stretch',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'right',
  },
  cardActions: {
    gap: 8,
    minWidth: 160,
  },
  primaryButton: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButton: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  neutralButton: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButton: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  inlineRow: {
    gap: 8,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    minWidth: 120,
  },
  totpDetails: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 12,
  },
  qrWrapper: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
  },
  totpInfo: {
    gap: 12,
  },
  secretRow: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 12,
  },
  secretText: {
    flex: 1,
    fontSize: 13,
    textAlign: 'right',
  },
  copyButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  copyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    gap: 8,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardSimpleRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stackGap: {
    gap: 10,
  },
  soundActions: {
    gap: 8,
    minWidth: 160,
    alignItems: 'stretch',
  },
  pinMetaRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  pinMetaText: {
    fontSize: 12,
    textAlign: 'right',
  },
  deviceUsageText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    marginTop: 4,
  },
  deviceErrorText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  deviceSections: {
    gap: 16,
  },
  deviceSection: {
    gap: 12,
  },
  deviceSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  deviceEmptyText: {
    fontSize: 12,
    textAlign: 'right',
  },
  deviceRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  deviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  deviceLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  deviceBadgesRow: {
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  deviceStatus: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  deviceTag: {
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    textAlign: 'center',
  },
  deviceMeta: {
    fontSize: 12,
    textAlign: 'right',
  },
  deviceActionsRow: {
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  deviceActionButton: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  deviceActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'right',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replaceList: {
    gap: 12,
  },
  replaceOption: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
  replaceOptionActive: {
    borderWidth: 2,
  },
  replaceOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  replaceOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  replaceOptionMeta: {
    fontSize: 12,
    textAlign: 'right',
  },
  replaceOptionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    fontSize: 11,
    textAlign: 'center',
  },
});
