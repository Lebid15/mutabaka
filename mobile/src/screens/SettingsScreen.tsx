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

const QR_SIZE = 180;
const SOUND_TEST_TIMEOUT_MS = 2500;

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode, toggleTheme } = useThemeMode();
  const isLight = mode === 'light';
  const isRTL = I18nManager.isRTL;

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

  const soundRef = useRef<Audio.Sound | null>(null);

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
      return () => {
        if (soundRef.current) {
          soundRef.current.unloadAsync().catch(() => undefined);
          soundRef.current = null;
        }
      };
    }, [loadTotp, refreshPinState]),
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
    <Text style={[styles.badge, { color: active ? palette.badgeActive : palette.badgeInactive }]}>{text}</Text>
  );

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
              <Text style={[styles.headerTitle, { color: palette.headerText }]}>الإعدادات</Text>
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
                    <View style={styles.cardHeaderText}>
                      <Text style={[styles.cardTitle, { color: palette.heading }]}>الوصول السريع برمز PIN</Text>
                      <Text style={[styles.cardSubtitle, { color: palette.subText }]}>إدارة رمز PIN المحلي لهذا الجهاز لتسجيل الدخول السريع.</Text>
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
                      <Text style={[styles.pinMetaText, { color: palette.subText }]}>مفعّل لحساب {pinState.displayName || pinState.username || 'الحالي'}.</Text>
                    </View>
                  ) : (
                    <Text style={[styles.cardSubtitle, { color: palette.subText }]}>لتمكين الوصول السريع، أنشئ رمز PIN لهذا الجهاز.</Text>
                  )}
                </View>

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <View style={styles.cardHeaderText}>
                      <Text style={[styles.cardTitle, { color: palette.heading }]}>الأمان: المصادقة الثنائية (TOTP)</Text>
                      <Text style={[styles.cardSubtitle, { color: palette.subText }]}>تعمل مع Google Authenticator أو تطبيقات مشابهة.</Text>
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
                        <Text style={[styles.cardSubtitle, { color: palette.subText }]}>Secret:</Text>
                        <View style={[styles.secretRow, { flexDirection: isRTL ? 'row-reverse' : 'row', borderColor: palette.pillBorder }]}
                        >
                          <Text style={[styles.secretText, { color: palette.heading }]} numberOfLines={2}>{totpSecret}</Text>
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
                      <Text style={[styles.loadingText, { color: palette.subText }]}>جاري التحميل…</Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <View style={styles.cardHeaderText}>
                      <Text style={[styles.cardTitle, { color: palette.heading }]}>المظهر</Text>
                      <Text style={[styles.cardSubtitle, { color: palette.subText }]}>بدّل بين الوضعين الفاتح والداكن عبر التطبيق.</Text>
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
                  <View style={styles.stackGap}>
                    <Text style={[styles.cardTitle, { color: palette.heading }]}>تثبيت التطبيق</Text>
                    <Text style={[styles.cardSubtitle, { color: palette.subText }]}>
                      التطبيق مثبت بالفعل لأنك تستخدم نسخة الجوال. يمكنك مشاركة التطبيق مع فريقك من متجر التطبيقات الخاص بك.
                    </Text>
                    <Pressable
                      style={[styles.neutralButton, { backgroundColor: palette.neutralButtonBg }]}
                      onPress={() => Alert.alert('معلومة', 'قم بزيارة الإصدار الويب للحصول على زر التثبيت على سطح المكتب.')}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.buttonText, { color: palette.neutralButtonText }]}>تفاصيل أكثر</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'flex-start' }]}
                  >
                    <View style={styles.cardHeaderText}>
                      <Text style={[styles.cardTitle, { color: palette.heading }]}>تشغيل صوت الإشعار</Text>
                      <Text style={[styles.cardSubtitle, { color: palette.subText }]}>عند وصول رسالة جديدة والتطبيق في الخلفية أو في محادثة أخرى.</Text>
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

                <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
                >
                  <View style={[styles.cardSimpleRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                  >
                    <View style={styles.cardHeaderText}>
                      <Text style={[styles.cardTitle, { color: palette.heading }]}>إشعارات الرسائل (Web Push)</Text>
                      <Text style={[styles.cardSubtitle, { color: palette.subText }]}>الميزة مخصصة لإصدار الويب. سنضيف دعماً كاملاً لتطبيق الجوال لاحقاً.</Text>
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
                      <Text style={[styles.cardSubtitle, { color: palette.subText }]}>الميزة غير متاحة حالياً على هذا الجهاز.</Text>
                    )}
                  </View>
                </View>
              </View>
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
});
