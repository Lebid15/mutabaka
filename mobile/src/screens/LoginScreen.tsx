import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FeatherIcon from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import BackgroundGradient from '../components/BackgroundGradient';
import ThemeToggle from '../components/ThemeToggle';
import { logoDefault } from '../assets/logoDefault';
import type { RootStackParamList } from '../navigation';
import { useThemeMode } from '../theme';
import { cn } from '../utils/cn';
import { loginAsTeamMember, loginWithIdentifier } from '../services/auth';
import { getBranding, getPolicyDocument, type PolicyDocumentType } from '../services/publicContent';

type PolicyContentSegment =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string };

export default function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { mode } = useThemeMode();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [useTeamLogin, setUseTeamLogin] = useState(false);
  const [ownerUsername, setOwnerUsername] = useState('');
  const [teamUsername, setTeamUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [brandingLogoUrl, setBrandingLogoUrl] = useState<string | null>(null);
  const [policyModalVisible, setPolicyModalVisible] = useState(false);
  const [policyTitle, setPolicyTitle] = useState('');
  const [policySegments, setPolicySegments] = useState<PolicyContentSegment[]>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const isDark = mode === 'dark';

  const cardClasses = cn('w-full max-w-[420px] gap-8 p-10 pt-10');

  const pageBackgroundColor = isDark ? '#0b141a' : '#fff9f3';

  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const branding = await getBranding();
        if (isActive) {
          setBrandingLogoUrl(branding.logo_url ?? null);
        }
      } catch (error) {
        console.warn('[Mutabaka] Failed to load branding', error);
      }
    })();
    return () => {
      isActive = false;
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (loading) {
      return;
    }
    try {
      setErrorMessage(null);
      setLoading(true);
      if (useTeamLogin) {
        if (!ownerUsername.trim() || !teamUsername.trim() || !password.trim()) {
          setErrorMessage('الرجاء إدخال جميع الحقول المطلوبة');
          return;
        }
        await loginAsTeamMember({
          ownerUsername: ownerUsername.trim(),
          teamUsername: teamUsername.trim(),
          password: password,
        });
      } else {
        if (!identifier.trim() || !password.trim()) {
          setErrorMessage('البريد الإلكتروني أو اسم المستخدم وكلمة المرور مطلوبة');
          return;
        }
        await loginWithIdentifier({
          identifier: identifier.trim(),
          password: password,
        });
      }
      navigation.replace('Home');
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message || 'تعذر تسجيل الدخول، حاول مرة أخرى');
      } else {
        setErrorMessage('تعذر تسجيل الدخول، حاول مرة أخرى');
      }
    } finally {
      setLoading(false);
    }
  }, [identifier, navigation, ownerUsername, password, teamUsername, useTeamLogin, loading]);

  const helperTextClass = cn('text-xs text-center mt-1', isDark ? 'text-[#94a3b8]' : 'text-[#857a72]');
  const policyLinkClass = cn('font-semibold', isDark ? 'text-[#34d399]' : 'text-[#2f9d73]');

  const iconColor = isDark ? '#9ca3af' : '#f5a34b';
  const placeholderColor = isDark ? '#94a3b8' : '#9ca3af';
  const RTL_MARK = '\u200F';

  const glowGradient = useMemo(
    () => (
      <LinearGradient
        pointerEvents="none"
        colors={isDark ? ['rgba(34,197,94,0.02)', 'rgba(34,197,94,0.18)', 'rgba(34,197,94,0)'] : ['rgba(255,188,120,0.08)', 'rgba(255,188,120,0.38)', 'rgba(255,188,120,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', top: -80, left: -60, right: -60, height: 260, borderRadius: 200, zIndex: -1 }}
      />
    ),
    [isDark],
  );

  type FeatherName = ComponentProps<typeof FeatherIcon>['name'];

  const modalPalette = useMemo(
    () => ({
      backdrop: 'rgba(0,0,0,0.45)',
      background: isDark ? '#0b141a' : '#fff9f3',
      border: isDark ? '#233138' : '#f1c59c',
      title: isDark ? '#f8fafc' : '#2d241a',
      body: isDark ? '#cbd5f5' : '#564434',
      closeIcon: isDark ? '#9ca3af' : '#6b6057',
      accent: isDark ? '#34d399' : '#2f9d73',
    }),
    [isDark],
  );

  const renderInput = (
    value: string,
    onChangeText: (text: string) => void,
    placeholder: string,
    icon: FeatherName,
    options?: { secureTextEntry?: boolean; keyboardType?: TextInputProps['keyboardType']; autoCapitalize?: TextInputProps['autoCapitalize'] },
  ) => (
    <View className="w-full">
      <View className={cn('w-full rounded-[20px] border flex-row items-center gap-3 px-4 py-[13px]', isDark ? 'bg-[#0b141a] border-[#233138]' : 'bg-white/90 border-[#f1c59c]')}>
        <FeatherIcon name={icon} size={18} color={iconColor} style={{ marginTop: 1 }} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={placeholderColor}
          secureTextEntry={options?.secureTextEntry}
          keyboardType={options?.keyboardType}
          autoCapitalize={options?.autoCapitalize}
          textAlign="right"
          className={cn('flex-1 text-base font-medium text-right', isDark ? 'text-white' : 'text-[#3c3127]')}
        />
      </View>
    </View>
  );

  const normalizePolicyContent = useCallback((raw: string): PolicyContentSegment[] => {
    if (!raw) {
      return [];
    }

    let text = raw
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*li\s*>/gi, '\n• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n')
      .replace(/<[^>]+>/g, '');

    const lines = text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const segments: PolicyContentSegment[] = [];
    lines.forEach((line) => {
      if (/^[•▪●◦○*-]/.test(line)) {
        const content = line.replace(/^[•▪●◦○*-]\s*/, '').trim();
        if (content.length) {
          segments.push({ type: 'bullet', text: content });
        }
      } else {
        segments.push({ type: 'paragraph', text: line });
      }
    });

    return segments;
  }, []);

  const openPolicyModal = useCallback(
    async (documentType: PolicyDocumentType) => {
      setPolicyModalVisible(true);
      setPolicyLoading(true);
      setPolicyError(null);
      try {
        const doc = await getPolicyDocument(documentType);
        const fallbackTitle = documentType === 'terms' ? 'شروط الاستخدام' : 'سياسة الخصوصية';
        setPolicyTitle(doc.title?.trim() || fallbackTitle);
        setPolicySegments(normalizePolicyContent(doc.content));
      } catch (error) {
        console.warn('[Mutabaka] Failed to load policy document', error);
        const fallbackTitle = documentType === 'terms' ? 'شروط الاستخدام' : 'سياسة الخصوصية';
        setPolicyTitle(fallbackTitle);
        setPolicySegments([]);
        setPolicyError('تعذر تحميل المحتوى. حاول مرة أخرى.');
      } finally {
        setPolicyLoading(false);
      }
    },
    [normalizePolicyContent],
  );

  const closePolicyModal = useCallback(() => {
    setPolicyModalVisible(false);
    setPolicyError(null);
  }, []);

  return (
    <BackgroundGradient>
      <View style={[styles.pageSurface, { backgroundColor: pageBackgroundColor }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
            <View className="flex-1 px-6 pt-2 pb-12">
              <View className="w-full flex-row-reverse items-center mt-10">
                <ThemeToggle />
                <Text className={cn('flex-1 text-center text-base font-semibold', isDark ? 'text-[#cbd5f5]' : 'text-[#f5a34b]')}>
                  مطابقة
                </Text>
              </View>
              <View className="flex-1 items-center" collapsable={false}>
                <View className="w-full max-w-[420px] items-center">
                  {glowGradient}
                  <View className={cardClasses}>
                    <View className="items-center">
                      {brandingLogoUrl ? (
                        <Image source={{ uri: brandingLogoUrl }} style={styles.logoImage} resizeMode="contain" />
                      ) : (
                        <SvgXml xml={logoDefault} width={150} height={150} />
                      )}
                    </View>

                    <View className="gap-6">
                      <Pressable
                        onPress={() => setUseTeamLogin((prev) => !prev)}
                        className="flex-row-reverse items-center gap-3 self-start"
                      >
                        <Text className={cn('text-xs font-medium', isDark ? 'text-[#cbd5f5]' : 'text-[#6b6057]')}>
                          تسجيل دخول عضو فريق
                        </Text>
                        <View
                          className={cn(
                            'w-4 h-4 rounded border items-center justify-center',
                            isDark ? 'border-[#2f3b42]' : 'border-[#f1c59c]',
                            useTeamLogin ? 'bg-[#22c55e] border-[#22c55e]' : 'bg-transparent',
                          )}
                        >
                          {useTeamLogin ? <FeatherIcon name="check" size={12} color="#ffffff" /> : null}
                        </View>
                      </Pressable>

                      <View className="gap-4">
                        {useTeamLogin ? (
                          <>
                            {renderInput(ownerUsername, setOwnerUsername, 'اسم مستخدم المالك', 'user', { autoCapitalize: 'none' })}
                            {renderInput(teamUsername, setTeamUsername, 'اسم مستخدم عضو الفريق', 'users', { autoCapitalize: 'none' })}
                          </>
                        ) : (
                          renderInput(identifier, setIdentifier, 'example@mutabaka.com', 'user', {
                            keyboardType: 'email-address',
                            autoCapitalize: 'none',
                          })
                        )}
                        {renderInput(password, setPassword, '••••••••', 'lock', { secureTextEntry: true, autoCapitalize: 'none' })}
                      </View>
                    </View>

                    <View className="gap-3">
                      <Pressable
                        onPress={handleSubmit}
                        className="h-[52px] rounded-[18px] bg-[#2f9d73] items-center justify-center"
                        disabled={loading}
                        accessibilityHint="ينقلك إلى الشاشة الرئيسية"
                      >
                        <Text className="text-white text-[15px] font-semibold tracking-wide">
                          {loading ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
                        </Text>
                      </Pressable>
                      {errorMessage ? (
                        <Text className={cn('text-xs text-center font-medium', isDark ? 'text-[#fca5a5]' : 'text-[#b91c1c]')}>
                          {errorMessage}
                        </Text>
                      ) : null}
                      <Text className={helperTextClass}>
                        بتسجيل الدخول فإنك توافق على{' '}
                        <Text className={policyLinkClass} onPress={() => openPolicyModal('terms')} accessibilityRole="button">
                          شروط الاستخدام
                        </Text>{' '}
                        و{' '}
                        <Text className={policyLinkClass} onPress={() => openPolicyModal('privacy')} accessibilityRole="button">
                          سياسة الخصوصية
                        </Text>
                        .
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        <Modal
          visible={policyModalVisible}
          transparent
          onRequestClose={closePolicyModal}
          animationType="fade"
        >
          <View style={[styles.modalContainer, { backgroundColor: modalPalette.backdrop }]}>
            <Pressable style={styles.modalOverlay} onPress={closePolicyModal} accessibilityRole="button" />
            <View style={[styles.modalCard, { backgroundColor: modalPalette.background, borderColor: modalPalette.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: modalPalette.title }]}>{policyTitle}</Text>
                <Pressable
                  onPress={closePolicyModal}
                  style={styles.modalCloseButton}
                  accessibilityRole="button"
                  accessibilityLabel="إغلاق النافذة"
                >
                  <FeatherIcon name="x" size={20} color={modalPalette.closeIcon} />
                </Pressable>
              </View>
              <View style={styles.modalContent}>
                {policyLoading ? (
                  <ActivityIndicator size="small" color={modalPalette.accent} />
                ) : policyError ? (
                  <Text style={[styles.modalErrorText, { color: modalPalette.title }]}>{policyError}</Text>
                ) : (
                  <ScrollView
                    style={[styles.modalScroll, styles.modalRtlContainer, { direction: 'rtl' }]}
                    contentContainerStyle={[styles.modalScrollContent, styles.modalRtlContainer, { direction: 'rtl' }]}
                  >
                    <View style={styles.modalContentWrapper}>
                      {policySegments.map((segment, index) => {
                        const isLast = index === policySegments.length - 1;
                        const spacingStyle = isLast ? null : styles.modalParagraphSpacing;
                        if (segment.type === 'bullet') {
                          return (
                            <View key={`bullet-${index}`} style={[styles.bulletRow, spacingStyle]}>
                              <Text style={[styles.bulletSymbol, { color: modalPalette.body }]}>•</Text>
                              <Text style={[styles.bulletText, { color: modalPalette.body }]} selectable>
                                {RTL_MARK}
                                {segment.text}
                              </Text>
                            </View>
                          );
                        }
                        return (
                          <Text
                            key={`paragraph-${index}`}
                            style={[styles.modalParagraphText, { color: modalPalette.body }, spacingStyle]}
                            selectable
                          >
                            {RTL_MARK}
                            {segment.text}
                          </Text>
                        );
                      })}
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </BackgroundGradient>
  );
}

const styles = StyleSheet.create({
  logoImage: {
    width: 150,
    height: 150,
  },
  pageSurface: {
    flex: 1,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
  },
  modalHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalCloseButton: {
    padding: 8,
    marginLeft: 8,
  },
  modalContent: {
    flexGrow: 1,
    alignSelf: 'stretch',
  },
  modalScroll: {
    maxHeight: '100%',
  },
  modalScrollContent: {
    paddingBottom: 12,
    alignItems: 'stretch',
  },
  modalRtlContainer: {
    alignSelf: 'stretch',
    writingDirection: 'rtl',
  },
  modalContentWrapper: {
    alignSelf: 'stretch',
    direction: 'rtl',
  },
  modalParagraphText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'left',
    writingDirection: 'rtl',
  },
  modalParagraphSpacing: {
    marginBottom: 12,
  },
  bulletRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
  },
  bulletSymbol: {
    fontSize: 14,
    lineHeight: 22,
    marginLeft: 8,
    writingDirection: 'rtl',
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalErrorText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
