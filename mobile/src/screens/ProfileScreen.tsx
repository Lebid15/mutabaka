import FeatherIcon from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackgroundGradient from '../components/BackgroundGradient';
import { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import {
  changePassword,
  fetchCurrentUser,
  type CurrentUser,
  updateProfile,
  uploadProfilePhoto,
} from '../services/user';
import { HttpError } from '../lib/httpClient';

interface FeedbackState {
  type: 'success' | 'error';
  message: string;
}

function extractMessage(error: unknown, fallback: string): string {
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
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function guessMimeType(filename: string | null | undefined): string {
  if (!filename) {
    return 'image/jpeg';
  }
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'heic':
      return 'image/heic';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

function buildFileNameFromUri(uri: string): string {
  const parts = uri.split('/');
  const last = parts.pop();
  if (last && last.includes('.')) {
    return last;
  }
  return `avatar-${Date.now()}.jpg`;
}

export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const isMountedRef = useRef(true);

  const isLight = mode === 'light';

  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const isRTL = I18nManager.isRTL;

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const colors = useMemo(() => ({
    headerIcon: isLight ? '#f97316' : '#facc15',
    headerText: isLight ? '#1f2937' : '#e2e8f0',
    panelBg: isLight ? 'rgba(255,255,255,0.92)' : '#0f1b22',
    panelBorder: isLight ? '#f2cdaa' : '#233138',
    panelShadow: isLight ? '#f3e5d7' : 'rgba(0,0,0,0.4)',
    label: isLight ? '#7f6857' : '#94a3b8',
    inputBg: isLight ? '#ffffff' : '#13222b',
    inputBorder: isLight ? '#f1c59c' : '#1f2d35',
    inputText: isLight ? '#3d3227' : '#f8fafc',
    inputPlaceholder: isLight ? '#b29276' : '#64748b',
    readonlyBg: isLight ? '#f9f5f0' : '#1a2b36',
    buttonPrimaryBg: isLight ? '#35b178' : '#22c55e',
    buttonPrimaryBgHover: isLight ? '#2da36c' : '#16a34a',
    buttonSecondaryBg: isLight ? '#3d82f6' : '#2563eb',
    buttonSecondaryBgHover: isLight ? '#2f6ee5' : '#1d4ed8',
    buttonText: '#ffffff',
    alertSuccessBg: isLight ? '#e7fbf3' : 'rgba(22, 163, 74, 0.25)',
    alertSuccessBorder: isLight ? '#b8ebd3' : 'rgba(52, 211, 153, 0.45)',
    alertSuccessText: isLight ? '#1d7d53' : '#bbf7d0',
    alertErrorBg: isLight ? '#fde6e3' : 'rgba(185, 28, 28, 0.35)',
    alertErrorBorder: isLight ? '#f4b4aa' : 'rgba(248, 113, 113, 0.45)',
    alertErrorText: isLight ? '#a43d32' : '#fecdd3',
    divider: isLight ? '#f2d5b6' : '#1f2d35',
    avatarBg: isLight ? '#f6dcc2' : '#1f2d35',
    avatarBorder: isLight ? '#e7c19f' : '#2a3a42',
    avatarText: isLight ? '#4f3c2b' : '#f8fafc',
    linkBg: isLight ? '#ffecd9' : 'rgba(148, 163, 184, 0.2)',
    linkBorder: isLight ? '#f0c8a0' : 'rgba(148, 163, 184, 0.35)',
    linkText: isLight ? '#6f513a' : '#e2e8f0',
  }), [isLight]);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      setFeedback(null);
      const data = await fetchCurrentUser();
      if (!isMountedRef.current) {
        return;
      }
      setMe(data);
      setDisplayName(data.display_name || '');
      setFirstName(data.first_name || '');
      setLastName(data.last_name || '');
  setPhone(data.phone || '');
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = extractMessage(error, 'تعذر تحميل المعلومات');
      setFeedback({ type: 'error', message });
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile]),
  );

  const handleSaveProfile = useCallback(async () => {
    try {
      setSavingProfile(true);
      setFeedback(null);
      const updated = await updateProfile({
        display_name: displayName.trim() || null,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
      });
      if (!isMountedRef.current) {
        return;
      }
      setMe(updated);
      setDisplayName(updated.display_name || '');
      setFirstName(updated.first_name || '');
      setLastName(updated.last_name || '');
  setPhone(updated.phone || '');
      setFeedback({ type: 'success', message: 'تم الحفظ' });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = extractMessage(error, 'فشل الحفظ');
      setFeedback({ type: 'error', message });
    } finally {
      if (isMountedRef.current) {
        setSavingProfile(false);
      }
    }
  }, [displayName, firstName, lastName, phone]);

  const handleChangePassword = useCallback(async () => {
    if (!oldPassword.trim() || !newPassword.trim()) {
      setFeedback({ type: 'error', message: 'يرجى إدخال كلمة المرور الحالية والجديدة' });
      return;
    }
    try {
      setChangingPw(true);
      setFeedback(null);
      await changePassword(oldPassword.trim(), newPassword.trim());
      if (!isMountedRef.current) {
        return;
      }
      setOldPassword('');
      setNewPassword('');
      setFeedback({ type: 'success', message: 'تم تغيير كلمة السر' });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = extractMessage(error, 'فشل تغيير كلمة السر');
      setFeedback({ type: 'error', message });
    } finally {
      if (isMountedRef.current) {
        setChangingPw(false);
      }
    }
  }, [newPassword, oldPassword]);

  const handlePickPhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('لا يمكن الوصول للصور', 'يرجى منح صلاحية الوصول للصور لتحديث صورة البروفايل.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.length) {
        return;
      }
      const asset = result.assets[0];
      const uri = asset.uri;
      if (!uri) {
        return;
      }
      setUploading(true);
      setFeedback(null);
      const name = asset.fileName || buildFileNameFromUri(uri);
      const mime = asset.mimeType || guessMimeType(name);
      const response = await uploadProfilePhoto({ uri, name, mimeType: mime });
      if (!isMountedRef.current) {
        return;
      }
      setMe((prev) => (prev ? { ...prev, logo_url: response.logo_url ?? prev.logo_url } : prev));
      setFeedback({ type: 'success', message: response.detail || 'تم تحديث الصورة' });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      const message = extractMessage(error, 'فشل رفع الصورة');
      setFeedback({ type: 'error', message });
    } finally {
      if (isMountedRef.current) {
        setUploading(false);
      }
    }
  }, []);

  const avatarInitials = useMemo(() => (
    me?.initials || me?.username?.slice(0, 2)?.toUpperCase() || 'U'
  ), [me?.initials, me?.username]);

  const subscriptionLabel = useMemo(() => {
    if (!me) {
      return '';
    }
    const days = typeof me.subscription_remaining_days === 'number'
      ? me.subscription_remaining_days
      : Number(me.subscription_remaining_days) || 0;
    return `${Math.max(0, days)} يوم`;
  }, [me]);

  return (
    <BackgroundGradient>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screenContainer}>
          <View
            style={[
              styles.header,
              {
                borderColor: colors.panelBorder,
                backgroundColor: colors.panelBg,
                flexDirection: isRTL ? 'row-reverse' : 'row',
              },
            ]}
            accessibilityRole="header"
          >
            <View style={[styles.headerTitleGroup, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="رجوع"
                style={styles.headerButton}
                onPress={() => navigation.goBack()}
              >
                <FeatherIcon
                  name={isRTL ? 'chevron-left' : 'chevron-right'}
                  size={22}
                  color={colors.headerIcon}
                />
              </Pressable>
              <Text style={[styles.headerTitle, { color: colors.headerText }]}>بروفايلي</Text>
            </View>
            <View style={styles.headerButton} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.panel, { backgroundColor: colors.panelBg, borderColor: colors.panelBorder }]}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.headerIcon} />
                  <Text style={[styles.loadingText, { color: colors.label }]}>جاري التحميل…</Text>
                </View>
              ) : null}

              {!loading && feedback ? (
                <View
                  style={[
                    styles.feedback,
                    feedback.type === 'success'
                      ? { backgroundColor: colors.alertSuccessBg, borderColor: colors.alertSuccessBorder }
                      : { backgroundColor: colors.alertErrorBg, borderColor: colors.alertErrorBorder },
                  ]}
                >
                  <Text
                    style={[
                      styles.feedbackText,
                      feedback.type === 'success'
                        ? { color: colors.alertSuccessText }
                        : { color: colors.alertErrorText },
                    ]}
                  >
                    {feedback.message}
                  </Text>
                </View>
              ) : null}

              {me ? (
                <View style={styles.formSection}>
                  <View style={styles.avatarRow}>
                    <View style={[styles.avatarWrapper, { backgroundColor: colors.avatarBg, borderColor: colors.avatarBorder }]}
                    >
                      {me.logo_url ? (
                        <Image source={{ uri: me.logo_url }} style={styles.avatarImage} resizeMode="cover" />
                      ) : (
                        <Text style={[styles.avatarInitials, { color: colors.avatarText }]}>{avatarInitials}</Text>
                      )}
                    </View>
                    <Pressable
                      onPress={handlePickPhoto}
                      style={[styles.linkButton, { backgroundColor: colors.linkBg, borderColor: colors.linkBorder }]}
                      accessibilityRole="button"
                      accessibilityLabel="تغيير صورة البروفايل"
                    >
                      <FeatherIcon name="image" size={16} color={colors.linkText} />
                      <Text style={[styles.linkButtonText, { color: colors.linkText }]}>
                        {uploading ? 'جاري الرفع…' : 'تغيير صورة البروفايل'}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.inputGrid}>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>الاسم الظاهر</Text>
                      <TextInput
                        value={displayName}
                        onChangeText={setDisplayName}
                        placeholder="الاسم الذي يظهر في الدردشة"
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                        textAlign="right"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>الاسم الأول</Text>
                      <TextInput
                        value={firstName}
                        onChangeText={setFirstName}
                        placeholder=""
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                        textAlign="right"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>الاسم الأخير</Text>
                      <TextInput
                        value={lastName}
                        onChangeText={setLastName}
                        placeholder=""
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                        textAlign="right"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>اسم المستخدم</Text>
                      <TextInput
                        value={me.username}
                        editable={false}
                        style={[styles.input, styles.inputReadonly, {
                          backgroundColor: colors.readonlyBg,
                          borderColor: colors.inputBorder,
                          color: colors.inputText,
                        }]}
                        textAlign="right"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>البريد الإلكتروني</Text>
                      <TextInput
                        value={me.email}
                        editable={false}
                        style={[styles.input, styles.inputReadonly, {
                          backgroundColor: colors.readonlyBg,
                          borderColor: colors.inputBorder,
                          color: colors.inputText,
                        }]}
                        textAlign="right"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>رقم الجوال</Text>
                      <TextInput
                        value={phone}
                        onChangeText={setPhone}
                        placeholder=""
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                        textAlign="right"
                        keyboardType="phone-pad"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>مدة الإشتراك المتبقية</Text>
                      <TextInput
                        value={subscriptionLabel}
                        editable={false}
                        style={[styles.input, styles.inputReadonly, {
                          backgroundColor: colors.readonlyBg,
                          borderColor: colors.inputBorder,
                          color: colors.inputText,
                        }]}
                        textAlign="right"
                      />
                    </View>
                  </View>

                  <Pressable
                    onPress={handleSaveProfile}
                    disabled={savingProfile}
                    style={[styles.primaryButton, {
                      backgroundColor: colors.buttonPrimaryBg,
                      opacity: savingProfile ? 0.6 : 1,
                    }]}
                    accessibilityRole="button"
                    accessibilityLabel="حفظ التعديلات"
                  >
                    {savingProfile ? (
                      <ActivityIndicator size="small" color={colors.buttonText} />
                    ) : (
                      <Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>حفظ</Text>
                    )}
                  </Pressable>

                  <View style={[styles.divider, { backgroundColor: colors.divider }]} />

                  <View style={styles.passwordRow}>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>كلمة السر الحالية</Text>
                      <TextInput
                        value={oldPassword}
                        onChangeText={setOldPassword}
                        secureTextEntry
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                        textAlign="right"
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.label }]}>كلمة السر الجديدة</Text>
                      <TextInput
                        value={newPassword}
                        onChangeText={setNewPassword}
                        secureTextEntry
                        placeholderTextColor={colors.inputPlaceholder}
                        style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
                        textAlign="right"
                      />
                    </View>
                  </View>

                  <Pressable
                    onPress={handleChangePassword}
                    disabled={changingPw}
                    style={[styles.secondaryButton, {
                      backgroundColor: colors.buttonSecondaryBg,
                      opacity: changingPw ? 0.6 : 1,
                    }]}
                    accessibilityRole="button"
                    accessibilityLabel="تغيير كلمة السر"
                  >
                    {changingPw ? (
                      <ActivityIndicator size="small" color={colors.buttonText} />
                    ) : (
                      <Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>تغيير كلمة السر</Text>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {!loading && !me ? (
                <Text style={[styles.loadingText, { color: colors.label }]}>لا توجد بيانات</Text>
              ) : null}
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
  screenContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  header: {
    marginTop: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  loadingText: {
    fontSize: 12,
  },
  feedback: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  feedbackText: {
    fontSize: 12,
    textAlign: 'right',
    fontWeight: '600',
  },
  formSection: {
    flexDirection: 'column',
    gap: 18,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    fontSize: 20,
    fontWeight: '700',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  linkButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputReadonly: {
    opacity: 0.65,
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
    borderRadius: 1,
  },
  passwordRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
