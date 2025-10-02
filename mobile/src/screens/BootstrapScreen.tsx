import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { hasUnlockedTokens } from '../lib/authStorage';
import { inspectState, clearAll } from '../lib/pinSession';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';

export default function BootstrapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const [message, setMessage] = useState<string>('جارِ التحقق من حالة الجلسة...');
  const pending = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (pending.current) {
        return;
      }
      pending.current = true;
      let cancelled = false;
      (async () => {
        try {
          if (hasUnlockedTokens()) {
            if (!cancelled) {
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            }
            return;
          }
          const state = await inspectState();
          if (cancelled) {
            return;
          }
          if (state.hasSecureSession) {
            navigation.reset({ index: 0, routes: [{ name: 'PinUnlock' }] });
            return;
          }
          await clearAll();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        } catch (error) {
          console.warn('[Mutabaka] bootstrap failed', error);
          setMessage('تعذر تهيئة التطبيق. سيتم تحويلك إلى شاشة تسجيل الدخول.');
          await clearAll();
          if (!cancelled) {
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          }
        }
      })();
      return () => {
        cancelled = true;
        pending.current = false;
      };
    }, [navigation]),
  );

  const isDark = mode === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0b141a' : '#fff9f3' }]}> 
      <ActivityIndicator size="large" color={isDark ? '#34d399' : '#2f9d73'} />
      <Text style={[styles.message, { color: isDark ? '#cbd5f5' : '#564434' }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
