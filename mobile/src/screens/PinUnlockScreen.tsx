import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import {
  clearAll,
  getLockState,
  unlockWithPin,
  updateSessionAfterUnlock,
  wipeIfEpochChanged,
  PinSessionError,
  inspectState,
} from '../lib/pinSession';
import type { RootStackParamList } from '../navigation';
import { fetchPinStatus } from '../services/pin';
import { useThemeMode } from '../theme';
import PinCodeInput, { type PinCodeInputHandle } from '../components/PinCodeInput';

function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds} ثانية`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const min = minutes % 60;
    return `${hours} ساعة ${min} دقيقة`;
  }
  return remainder > 0 ? `${minutes} دقيقة و ${remainder} ثانية` : `${minutes} دقيقة`;
}

export default function PinUnlockScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'PinUnlock'>>();
  const { mode } = useThemeMode();
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lockRemainingMs, setLockRemainingMs] = useState<number>(0);
  const initialGreeting = route.params?.displayName ?? '';
  const [greetingName, setGreetingName] = useState<string>(initialGreeting);
  const intent = route.params?.intent ?? 'unlock';
  const pinInputRef = useRef<PinCodeInputHandle>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lock = await getLockState();
      if (!cancelled && lock?.locked && lock.remainingMs > 0) {
        setLockRemainingMs(lock.remainingMs);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (lockRemainingMs <= 0) {
      return;
    }
    const id = setInterval(() => {
      setLockRemainingMs((prev) => (prev > 1000 ? prev - 1000 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [lockRemainingMs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await inspectState();
        if (cancelled) {
          return;
        }
        const metaName = state.metadata?.displayName || state.metadata?.username || '';
        if (metaName) {
          setGreetingName(metaName);
        }
      } catch (error) {
        console.warn('[Mutabaka] Failed to load PIN metadata', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const attemptUnlock = useCallback(async (candidate: string) => {
    if (submittingRef.current) {
      return;
    }
    const sanitized = candidate.replace(/[^0-9]/g, '').slice(0, 6);
    if (sanitized.length !== 6) {
      setError('يرجى إدخال رمز PIN مكوّن من 6 أرقام.');
      return;
    }
    if (lockRemainingMs > 0) {
      const message = `المحاولات مغلقة مؤقتًا. حاول بعد ${formatRemaining(lockRemainingMs)}.`;
      setError(message);
      Vibration.vibrate(80);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { tokens, metadata } = await unlockWithPin(sanitized);
      const status = await fetchPinStatus();
      const epochChanged = await wipeIfEpochChanged(status);
      if (epochChanged) {
        setPin('');
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }

      await updateSessionAfterUnlock({
        pin: sanitized,
        tokens,
        serverStatus: status,
        metadata,
        displayName: metadata.displayName ?? greetingName ?? null,
        username: metadata.username ?? null,
      });

      setPin('');

      if (intent === 'change') {
        navigation.reset({
          index: 0,
          routes: [
            {
              name: 'PinSetup',
              params: {
                userId: metadata.userId,
                tokens,
                pinStatus: status,
                displayName: metadata.displayName ?? greetingName ?? null,
                username: metadata.username ?? null,
                mode: 'change',
              },
            },
          ],
        });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    } catch (err) {
      if (err instanceof PinSessionError) {
        if (err.code === 'LOCKED') {
          const remaining = err.remainingMs ?? 0;
          setLockRemainingMs(remaining);
          setError(`تم قفل المحاولة مؤقتًا. حاول بعد ${formatRemaining(remaining)}.`);
          Vibration.vibrate(80);
        } else if (err.code === 'INVALID_PIN') {
          const remaining = err.remainingMs ?? 0;
          if (remaining > 0) {
            setLockRemainingMs(remaining);
          }
          setError('رمز PIN غير صحيح. حاول مرة أخرى.');
          Vibration.vibrate([0, 80, 40, 80]);
          setPin('');
          pinInputRef.current?.clear();
          pinInputRef.current?.focus();
        } else {
          setError('لا يوجد جلسة متاحة. الرجاء تسجيل الدخول من جديد.');
          await clearAll();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        }
      } else {
        console.warn('[Mutabaka] PIN unlock failed', err);
        setError('حدث خطأ أثناء التحقق من رمز PIN.');
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }, [greetingName, intent, lockRemainingMs, navigation]);

  useEffect(() => {
    if (pin.length === 6 && !loading) {
      attemptUnlock(pin);
    }
  }, [attemptUnlock, loading, pin]);

  const handleSwitchUser = useCallback(async () => {
    await clearAll();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const isDark = mode === 'dark';
  const containerStyle = useMemo(() => [styles.container, { backgroundColor: isDark ? '#0b141a' : '#fff9f3' }], [isDark]);
  const cardStyle = useMemo(() => [styles.card, { backgroundColor: isDark ? '#132029' : '#ffffff' }], [isDark]);
  const labelStyle = useMemo(() => [styles.label, { color: isDark ? '#cbd5f5' : '#3c3127' }], [isDark]);
  const verifyingTextStyle = useMemo(() => [styles.verifyingText, { color: isDark ? '#cbd5f5' : '#334155' }], [isDark]);
  const errorStyle = useMemo(() => [styles.errorText, { color: isDark ? '#f87171' : '#b91c1c' }], [isDark]);

  return (
    <KeyboardAvoidingView style={containerStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={cardStyle}>
        <Text style={styles.title}>أدخل رمز PIN</Text>
        <Text style={styles.greeting}>{greetingName ? `مرحبًا ${greetingName}` : 'مرحبًا بك!'}</Text>
        <Text style={labelStyle}>للوصول السريع، أدخل الرمز المكوّن من 6 أرقام الذي أنشأته سابقًا.</Text>
        <PinCodeInput
          ref={pinInputRef}
          value={pin}
          onChange={(text) => setPin(text.replace(/[^0-9]/g, '').slice(0, 6))}
          status={error ? 'error' : 'default'}
          isDark={isDark}
          autoFocus
        />
        {loading && !error && lockRemainingMs <= 0 && (
          <Text style={verifyingTextStyle}>جاري التحقق...</Text>
        )}
        {lockRemainingMs > 0 && (
          <View style={styles.infoBox}>
            <Text style={[styles.infoText, { color: isDark ? '#facc15' : '#b45309' }]}>تم قفل إدخال الرقم مؤقتًا.</Text>
            <Text style={[styles.infoText, { color: isDark ? '#facc15' : '#b45309' }]}>
              يمكنك المحاولة بعد {formatRemaining(lockRemainingMs)}.
            </Text>
          </View>
        )}
        {error && <Text style={errorStyle}>{error}</Text>}
        <Pressable
          onPress={() => attemptUnlock(pin)}
          disabled={loading || lockRemainingMs > 0 || pin.length !== 6}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: loading || lockRemainingMs > 0 || pin.length !== 6
                ? '#94a3b8'
                : isDark
                  ? '#34d399'
                  : '#2f9d73',
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>دخول</Text>}
        </Pressable>
        <Pressable onPress={handleSwitchUser} style={styles.switchButton}>
          <Text style={[styles.switchText, { color: isDark ? '#a5b4fc' : '#1d4ed8' }]}>تبديل المستخدم</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 24,
    paddingTop: 80,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 24,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    color: '#10b981',
  },
  label: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  infoBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
  },
  infoText: {
    textAlign: 'center',
    fontSize: 13,
  },
  greeting: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    color: '#10b981',
  },
  verifyingText: {
    fontSize: 13,
    textAlign: 'center',
  },
  switchButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  switchText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
