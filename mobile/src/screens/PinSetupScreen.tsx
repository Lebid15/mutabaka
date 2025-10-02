import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { type AuthTokens } from '../lib/authStorage';
import { setPinForSession, clearAll } from '../lib/pinSession';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import PinCodeInput, { type PinCodeInputHandle } from '../components/PinCodeInput';

function sanitizePin(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 6);
}

export type PinSetupParams = RootStackParamList['PinSetup'];

type Route = RouteProp<RootStackParamList, 'PinSetup'>;

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function PinSetupScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const { tokens, userId, pinStatus, displayName, username, mode: flowMode } = route.params;
  const { mode } = useThemeMode();
  const [pin, setPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primaryInputRef = useRef<PinCodeInputHandle>(null);
  const confirmInputRef = useRef<PinCodeInputHandle>(null);

  const intent = flowMode ?? 'initial';
  const isChangeFlow = intent === 'change';
  const friendlyName = (displayName || username || '').trim();

  const isDark = mode === 'dark';
  const containerStyle = useMemo(() => [styles.container, { backgroundColor: isDark ? '#0b141a' : '#fff9f3' }], [isDark]);
  const cardStyle = useMemo(() => [styles.card, { backgroundColor: isDark ? '#132029' : '#ffffff' }], [isDark]);
  const helperStyle = useMemo(() => [styles.helperText, { color: isDark ? '#cbd5f5' : '#564434' }], [isDark]);
  const errorStyle = useMemo(() => [styles.errorText, { color: isDark ? '#f87171' : '#b91c1c' }], [isDark]);

  useEffect(() => {
    if (error && (pin.length < 6 || confirmPin.length < 6)) {
      setError(null);
    }
  }, [confirmPin, pin, error]);

  useEffect(() => {
    if (pin.length === 6) {
      confirmInputRef.current?.focus();
    }
  }, [pin]);

  const handleComplete = useCallback(async () => {
    if (loading) {
      return;
    }
    const sanitizedPin = sanitizePin(pin);
    const sanitizedConfirm = sanitizePin(confirmPin);
    if (sanitizedPin.length !== 6 || sanitizedConfirm.length !== 6) {
      setError('يجب أن يتكوّن رمز PIN من 6 أرقام.');
      Vibration.vibrate(60);
      return;
    }
    if (sanitizedPin !== sanitizedConfirm) {
      setError('الرمزان غير متطابقين.');
      Vibration.vibrate(60);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sessionTokens: AuthTokens = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
      await setPinForSession({
        pin: sanitizedPin,
        tokens: sessionTokens,
        userId,
        serverStatus: pinStatus,
        displayName: displayName ?? null,
        username: username ?? null,
      });

      if (navigation.canGoBack()) {
        Alert.alert('تم', 'تم إعداد رمز PIN بنجاح.', [
          {
            text: 'حسناً',
            onPress: () => {
              navigation.goBack();
            },
          },
        ]);
        return;
      }

      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      return;
    } catch (err) {
      console.warn('[Mutabaka] Failed to configure PIN session', err);
      setError('تعذر إعداد رمز PIN. حاول مرة أخرى.');
      Vibration.vibrate(80);
    } finally {
      setLoading(false);
    }
  }, [confirmPin, displayName, loading, navigation, pin, pinStatus, tokens, userId, username]);

  const handleSkip = useCallback(async () => {
    if (isChangeFlow) {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      return;
    }
    await clearAll({ keepTokens: true });
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [isChangeFlow, navigation]);

  return (
    <KeyboardAvoidingView style={containerStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={cardStyle}>
        <Text style={styles.title}>{isChangeFlow ? 'تغيير رمز PIN' : 'إنشاء رمز PIN'}</Text>
        <Text style={helperStyle}>
          {isChangeFlow
            ? `اختر رمز PIN جديدًا لهذا الجهاز${friendlyName ? ` (${friendlyName})` : ''} لضمان حماية جلساتك.`
            : 'قم باختيار رمز PIN مكوّن من 6 أرقام للوصول السريع والآمن. سيُستخدم هذا الرمز لفك تشفير الجلسة المخزّنة على هذا الجهاز فقط.'}
        </Text>
        <PinCodeInput
          ref={primaryInputRef}
          value={pin}
          onChange={(text) => setPin(sanitizePin(text))}
          status={error ? 'error' : 'default'}
          autoFocus
          isDark={isDark}
          label="الرمز الجديد"
        />
        <PinCodeInput
          ref={confirmInputRef}
          value={confirmPin}
          onChange={(text) => setConfirmPin(sanitizePin(text))}
          status={error ? 'error' : 'default'}
          isDark={isDark}
          label="تأكيد الرمز"
          onFilled={() => {
            if (!loading) {
              handleComplete();
            }
          }}
        />
        {error && <Text style={errorStyle}>{error}</Text>}
        <Pressable
          onPress={handleComplete}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: loading ? '#94a3b8' : isDark ? '#34d399' : '#2f9d73',
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>حفظ الرمز</Text>}
        </Pressable>
        <Pressable onPress={handleSkip} style={styles.linkButton}>
          <Text style={[styles.linkText, { color: isDark ? '#60a5fa' : '#2563eb' }]}>
            {isChangeFlow ? 'إلغاء والعودة' : 'تخطي مؤقتًا'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
  helperText: {
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
});
