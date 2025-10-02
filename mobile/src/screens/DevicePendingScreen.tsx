import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import BackgroundGradient from '../components/BackgroundGradient';
import { useThemeMode } from '../theme';
import type { RootStackParamList } from '../navigation';
import { performLogin, AuthenticationError, logout } from '../services/auth';
import { linkCurrentDevice, isDeviceActive, HttpError } from '../services/devices';
import { navigateAfterLogin } from '../utils/loginFlow';
import type { AuthTokens } from '../lib/authStorage';

type Route = RouteProp<RootStackParamList, 'DevicePending'>;
type Navigation = NativeStackNavigationProp<RootStackParamList>;

type FetchResult = {
  status: 'active' | 'pending' | 'failed';
  message?: string;
  requiresReplace?: boolean;
};

const POLL_INTERVAL_MS = 15000;

export default function DevicePendingScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const { mode } = useThemeMode();

  const { credentials, device: initialDevice, pendingToken: initialPendingToken, expiresAt: initialExpiresAt, requiresReplace: initialRequiresReplace, lastAccessToken } = route.params;

  const [device, setDevice] = useState(initialDevice);
  const [pendingToken, setPendingToken] = useState<string | null>(initialPendingToken);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);
  const [requiresReplace, setRequiresReplace] = useState<boolean>(initialRequiresReplace);
  const [accessToken, setAccessToken] = useState<string>(lastAccessToken);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => {
    if (!expiresAt) {
      return null;
    }
    const expiresTs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresTs)) {
      return null;
    }
    return Math.max(0, expiresTs - now);
  }, [expiresAt, now]);

  const countdownText = useMemo(() => {
    if (remainingMs === null) {
      return 'لم يتم تحديد وقت انتهاء الطلب بعد.';
    }
    if (remainingMs <= 0) {
      return 'انتهت صلاحية الطلب الحالي. أعد تسجيل الدخول لإرسال طلب جديد إذا لزم الأمر.';
    }
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `الوقت المتبقي: ${minutes} دقيقة و ${seconds.toString().padStart(2, '0')} ثانية.`;
    }
    return `الوقت المتبقي: ${seconds} ثانية.`;
  }, [remainingMs]);

  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const fetchStatus = useCallback(async (token: string): Promise<FetchResult> => {
    try {
      const response = await linkCurrentDevice({ accessToken: token });
      const nextDevice = response.device;
      setDevice(nextDevice);
      setPendingToken(nextDevice?.pending_token ?? null);
      setExpiresAt(nextDevice?.pending_expires_at ?? null);
      const needsReplace = Boolean(nextDevice?.requires_replace);
      setRequiresReplace(needsReplace);
      if (isDeviceActive(nextDevice?.status)) {
        return { status: 'active', requiresReplace: needsReplace };
      }
      return { status: 'pending', requiresReplace: needsReplace };
    } catch (error) {
      if (error instanceof HttpError) {
        const detail = typeof error.payload === 'object' && error.payload && 'detail' in error.payload
          ? String((error.payload as Record<string, unknown>).detail)
          : null;
        return { status: 'failed', message: detail || 'تعذر تحديث حالة الجهاز.' };
      }
      if (error instanceof Error) {
        return { status: 'failed', message: error.message || 'تعذر تحديث حالة الجهاز.' };
      }
      return { status: 'failed', message: 'تعذر تحديث حالة الجهاز.' };
    }
  }, []);

  const handleRefresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent && checking) {
      return;
    }
    if (!silent) {
      setChecking(true);
      setErrorMessage(null);
    }
    try {
      let tokenToUse = accessToken;
      let statusResult: FetchResult | null = null;

      if (tokenToUse) {
        statusResult = await fetchStatus(tokenToUse);
        if (statusResult.status === 'failed') {
          if (!silent && statusResult.message) {
            setErrorMessage(statusResult.message);
          }
          tokenToUse = '';
        }
      }

      if (!tokenToUse) {
        try {
          const loginResponse = await performLogin(credentials, { includeDeviceId: false });
          tokenToUse = loginResponse.access;
          setAccessToken(loginResponse.access);
          statusResult = await fetchStatus(loginResponse.access);
          if (statusResult.status === 'failed' && !silent && statusResult.message) {
            setErrorMessage(statusResult.message);
          }
        } catch (authError) {
          if (!silent) {
            if (authError instanceof AuthenticationError) {
              setErrorMessage(authError.message);
            } else if (authError instanceof Error) {
              setErrorMessage(authError.message || 'تعذر تحديث حالة الجهاز.');
            } else {
              setErrorMessage('تعذر تحديث حالة الجهاز.');
            }
          }
          return;
        }
      }

      if (!statusResult) {
        return;
      }

      if (statusResult.status === 'active') {
        const finalResponse = await performLogin(credentials, { includeDeviceId: true });
        if (finalResponse.refresh) {
          const tokens: AuthTokens = {
            accessToken: finalResponse.access,
            refreshToken: finalResponse.refresh,
          };
          await navigateAfterLogin(navigation, tokens);
        }
        return;
      }

      if (!silent) {
        if (statusResult.status === 'failed' && statusResult.message) {
          setErrorMessage(statusResult.message);
        } else if (statusResult.status === 'pending') {
          const needsReplace = statusResult.requiresReplace ?? requiresReplace;
          setErrorMessage(needsReplace
            ? 'الطلب بانتظار الموافقة وقد يحتاج إلى استبدال جهاز نشط.'
            : 'الطلب بانتظار موافقة المالك الأساسي.');
        }
      }
    } finally {
      if (!silent) {
        setChecking(false);
      }
    }
  }, [accessToken, checking, credentials, fetchStatus, navigation, requiresReplace]);

  useEffect(() => {
    handleRefresh({ silent: true }).catch(() => undefined);
  }, [handleRefresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      handleRefresh({ silent: true }).catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [handleRefresh]);

  const handleCopyToken = useCallback(async () => {
    if (!pendingToken) {
      return;
    }
    try {
      await Clipboard.setStringAsync(pendingToken);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setErrorMessage('تعذر نسخ رمز الطلب. يرجى نسخه يدويًا عند الحاجة.');
    }
  }, [pendingToken]);

  const handleBackToLogin = useCallback(async () => {
    await logout({ wipePinSession: true });
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const cardBackground = mode === 'dark' ? '#132029' : '#ffffff';
  const pageBackground = mode === 'dark' ? '#0b141a' : '#fff9f3';
  const titleColor = mode === 'dark' ? '#f8fafc' : '#2d241a';
  const bodyColor = mode === 'dark' ? '#cbd5f5' : '#564434';
  const subtleColor = mode === 'dark' ? '#64748b' : '#7c6f66';
  const accentColor = mode === 'dark' ? '#34d399' : '#2f9d73';
  const dangerColor = mode === 'dark' ? '#fca5a5' : '#b91c1c';

  const deviceLabel = device?.label || 'جهاز بدون اسم';
  const devicePlatform = device?.platform || 'غير معروف';

  return (
    <BackgroundGradient>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.flex, { backgroundColor: pageBackground }]}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.card, { backgroundColor: cardBackground }]}
          >
            <Text style={[styles.title, { color: titleColor }]}>بانتظار موافقة الجهاز</Text>
            <Text style={[styles.body, { color: bodyColor }]}
            >
              تم إرسال طلب ربط هذا الجهاز. يحتاج مالك الحساب الأساسي إلى الموافقة على الطلب حتى تتمكن من المتابعة.
            </Text>

            <View style={styles.section}
            >
              <Text style={[styles.sectionTitle, { color: titleColor }]}>تفاصيل الجهاز</Text>
              <View style={styles.infoRow}
              >
                <Text style={[styles.infoLabel, { color: subtleColor }]}>الاسم:</Text>
                <Text style={[styles.infoValue, { color: titleColor }]}>{deviceLabel}</Text>
              </View>
              <View style={styles.infoRow}
              >
                <Text style={[styles.infoLabel, { color: subtleColor }]}>المنصة:</Text>
                <Text style={[styles.infoValue, { color: titleColor }]}>{devicePlatform}</Text>
              </View>
              <View style={styles.infoRow}
              >
                <Text style={[styles.infoLabel, { color: subtleColor }]}>الإصدار:</Text>
                <Text style={[styles.infoValue, { color: titleColor }]}>{device?.app_version || 'غير محدد'}</Text>
              </View>
            </View>

            <View style={styles.section}
            >
              <Text style={[styles.sectionTitle, { color: titleColor }]}>معرف الطلب</Text>
              <View style={styles.tokenRow}
              >
                <Text style={[styles.tokenText, { color: titleColor }]} selectable>
                  {pendingToken ?? 'لم يتم إصدار رمز بعد.'}
                </Text>
                {pendingToken ? (
                  <Pressable
                    onPress={handleCopyToken}
                    style={({ pressed }) => [styles.copyButton, { opacity: pressed ? 0.75 : 1, borderColor: accentColor }]}
                  >
                    <Text style={[styles.copyButtonText, { color: accentColor }]}>نسخ</Text>
                  </Pressable>
                ) : null}
              </View>
              {copied ? (
                <Text style={[styles.copiedNote, { color: accentColor }]}>تم نسخ رمز الطلب بنجاح.</Text>
              ) : null}
            </View>

            <View style={styles.section}
            >
              <Text style={[styles.sectionTitle, { color: titleColor }]}>الوقت المتبقي</Text>
              <Text style={[styles.body, { color: bodyColor }]}>{countdownText}</Text>
            </View>

            {requiresReplace ? (
              <View style={[styles.alertBox, { borderColor: accentColor }]}
              >
                <Text style={[styles.alertText, { color: accentColor }]}
                >
                  يبدو أن الحد الأقصى للأجهزة النشطة قد تحقق. اطلب من المالك الأساسي استبدال أحد الأجهزة الحالية للموافقة على هذا الطلب.
                </Text>
              </View>
            ) : null}

            {errorMessage ? (
              <View style={styles.errorBox}
              >
                <Text style={[styles.errorText, { color: dangerColor }]}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.actions}
            >
              <Pressable
                onPress={() => handleRefresh()}
                disabled={checking}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: accentColor,
                    opacity: pressed || checking ? 0.85 : 1,
                  },
                ]}
              >
                {checking ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>تحديث الحالة</Text>}
              </Pressable>
              <Pressable
                onPress={handleBackToLogin}
                style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={[styles.secondaryButtonText, { color: subtleColor }]}>العودة إلى تسجيل الدخول</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: 28,
    padding: 24,
    gap: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  tokenRow: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  tokenText: {
    flex: 1,
    fontSize: 14,
    textAlign: 'left',
  },
  copyButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  copyButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  copiedNote: {
    fontSize: 12,
    textAlign: 'left',
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  alertText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorBox: {
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButton: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
