import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FeatherIcon from '@expo/vector-icons/Feather';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
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
import { performLogin, AuthenticationError, type LoginCredentials, type LoginResponse } from '../services/auth';
import { linkCurrentDevice, isDeviceActive, HttpError } from '../services/devices';
import { navigateAfterLogin } from '../utils/loginFlow';
import type { AuthTokens } from '../lib/authStorage';
import { inspectState } from '../lib/pinSession';
import { getExpoPushToken } from '../lib/pushNotifications';
import {
  getBranding,
  getContactLinks,
  getPolicyDocument,
  type ContactLink as ContactLinkDTO,
  type PolicyDocumentType,
} from '../services/publicContent';

type PolicyContentSegment =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string };

type ContactIconMeta = {
  backgroundColor: string;
  iconColorLight: string;
  iconColorDark: string;
  shadowColor: string;
  rippleColor?: string;
  renderIcon: (size: number, color: string) => ReactElement;
};

type ContactLinkView = ContactLinkDTO & {
  href: string;
  display: string;
  subtitle?: string;
  meta: ContactIconMeta;
};

const CONTACT_TILE_SIZE = 50;
const CONTACT_TILE_RADIUS = CONTACT_TILE_SIZE / 2;
const CONTACT_ICON_SIZE = 28;

const CONTACT_ICON_META: Record<string, ContactIconMeta> = {
  whatsapp: {
    backgroundColor: 'rgba(0, 185, 114, 1)',
    iconColorLight: '#ffffffff',
    iconColorDark: '#f8fafc',
    shadowColor: 'rgba(18,140,126,0.5)',
    rippleColor: 'rgba(37,211,102,0.18)',
    renderIcon: (size, color) => <Ionicons name="logo-whatsapp" size={size} color={color} />,
  },
  facebook: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(37,99,235,0.45)',
    rippleColor: 'rgba(59,130,246,0.18)',
    renderIcon: (size, color) => <FontAwesome5 name="facebook-f" size={size} color={color} />,
  },
  youtube: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(239,68,68,0.45)',
    rippleColor: 'rgba(239,68,68,0.18)',
    renderIcon: (size, color) => <FontAwesome5 name="youtube" size={size} color={color} />,
  },
  telegram: {
    backgroundColor: 'rgba(34,158,217,0.12)',
    iconColorLight: '#229ed9',
    iconColorDark: '#229ed9',
    shadowColor: 'rgba(37,150,221,0.45)',
    rippleColor: 'rgba(34,158,217,0.18)',
    renderIcon: (size, color) => <FontAwesome5 name="telegram-plane" size={size} color={color} />,
  },
  instagram: {
    backgroundColor: 'rgba(219,39,119,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(190,24,93,0.5)',
    rippleColor: 'rgba(219,39,119,0.18)',
    renderIcon: (size, color) => <FontAwesome5 name="instagram" size={size} color={color} />,
  },
  twitter: {
    backgroundColor: 'rgba(30,41,59,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(15,23,42,0.5)',
    rippleColor: 'rgba(30,41,59,0.18)',
    renderIcon: (size, color) => <FontAwesome6 name="x-twitter" size={size} color={color} />,
  },
  tiktok: {
    backgroundColor: 'rgba(15,23,42,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(15,23,42,0.45)',
    rippleColor: 'rgba(250,250,250,0.12)',
    renderIcon: (size, color) => <FontAwesome6 name="tiktok" size={size} color={color} />,
  },
  snapchat: {
    backgroundColor: 'rgba(250,204,21,0.16)',
    iconColorLight: '#0f172a',
    iconColorDark: '#111827',
    shadowColor: 'rgba(234,179,8,0.5)',
    rippleColor: 'rgba(250,204,21,0.22)',
    renderIcon: (size, color) => <FontAwesome5 name="snapchat-ghost" size={size} color={color} />,
  },
  linkedin: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(14,165,233,0.48)',
    rippleColor: 'rgba(59,130,246,0.18)',
    renderIcon: (size, color) => <FontAwesome5 name="linkedin-in" size={size} color={color} />,
  },
  email: {
    backgroundColor: 'rgba(255,138,0,0.12)',
    iconColorLight: '#0f172a',
    iconColorDark: '#ffffff',
    shadowColor: 'rgba(234,88,12,0.42)',
    rippleColor: 'rgba(255,138,0,0.18)',
    renderIcon: (size, color) => <Ionicons name="mail" size={size} color={color} />,
  },
};

const DEFAULT_CONTACT_ICON_META: ContactIconMeta = {
  backgroundColor: 'rgba(148,163,184,0.12)',
  iconColorLight: '#0f172a',
  iconColorDark: '#f8fafc',
  shadowColor: 'rgba(51,65,85,0.4)',
  rippleColor: 'rgba(148,163,184,0.16)',
  renderIcon: (size, color) => <FeatherIcon name="link-2" size={size} color={color} />,
};

const normalizeContactHref = (icon: string, raw: string): string => {
  const value = (raw || '').trim();
  if (!value) {
    return '';
  }
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) {
    return value;
  }
  if (icon === 'email' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return `mailto:${value}`;
  }
  if (icon === 'whatsapp') {
    const digits = value.replace(/[^+\d]/g, '');
    if (digits) {
      const normalized = digits.startsWith('+') ? digits.slice(1) : digits;
      return `https://wa.me/${normalized.replace(/[^\d]/g, '')}`;
    }
  }
  if (icon === 'telegram') {
    const username = value.replace(/^@/, '');
    if (username && /^[A-Za-z0-9_]+$/.test(username)) {
      return `https://t.me/${username}`;
    }
  }
  if (icon === 'snapchat') {
    const username = value.replace(/^@/, '');
    if (username) {
      return `https://www.snapchat.com/add/${username}`;
    }
  }
  if (!/^https?:\/\//i.test(value)) {
    return `https://${value}`;
  }
  return value;
};

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
  const [contactLinks, setContactLinks] = useState<ContactLinkView[]>([]);
  const [pinAvailable, setPinAvailable] = useState(false);
  const [pinDisplayName, setPinDisplayName] = useState<string | null>(null);

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

  const shouldRetryWithoutDevice = (code?: string) => Boolean(code && code.startsWith('device_'));

  const handleLoginResponse = useCallback(async (loginData: LoginResponse, credentials: LoginCredentials) => {
    if (!loginData || !loginData.access) {
      throw new Error('تعذر استلام رمز الدخول من الخادم.');
    }

    if (loginData.refresh) {
      const tokens: AuthTokens = {
        accessToken: loginData.access,
        refreshToken: loginData.refresh,
      };
      await navigateAfterLogin(navigation, tokens);
      return;
    }

    let linkResult;
    try {
      // محاولة الحصول على Push Token (بدون blocking)
      let pushToken: string | null = null;
      try {
        console.log('[Login] 🔔 Getting push token...');
        pushToken = await getExpoPushToken();
        if (pushToken) {
          console.log('[Login] ✅ Push token obtained successfully:', pushToken);
        } else {
          console.warn('[Login] ⚠️ Push token is null');
        }
      } catch (tokenError) {
        console.error('[Login] ❌ Failed to get push token:', tokenError);
        // نستمر بدون push token - ليس خطأ حرج
      }

      console.log('[Login] 📱 Linking device with pushToken:', pushToken ? 'YES' : 'NO');
      linkResult = await linkCurrentDevice({ 
        accessToken: loginData.access,
        pushToken,
      });
      console.log('[Login] ✅ Device linked successfully:', linkResult);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      if (error instanceof HttpError) {
        const detail = typeof error.payload === 'object' && error.payload && 'detail' in error.payload
          ? String((error.payload as Record<string, unknown>).detail)
          : null;
        
        // ترجمة الرسائل الإنجليزية إلى العربية
        let errorMessage = detail || 'تعذر ربط الجهاز، حاول مرة أخرى.';
        if (detail?.toLowerCase().includes('no active account')) {
          errorMessage = 'تأكد من المعلومات وحاول مجدداً';
        }
        
        throw new Error(errorMessage);
      }
      if (error instanceof Error) {
        throw new Error(error.message || 'تعذر ربط الجهاز، حاول مرة أخرى.');
      }
      throw new Error('تعذر ربط الجهاز، حاول مرة أخرى.');
    }

    const device = linkResult.device;

    if (isDeviceActive(device?.status)) {
      const retry = await performLogin(credentials, { includeDeviceId: true });
      if (retry.refresh) {
        const tokens: AuthTokens = {
          accessToken: retry.access,
          refreshToken: retry.refresh,
        };
        await navigateAfterLogin(navigation, tokens);
        return;
      }
    }

    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'DevicePending',
          params: {
            credentials,
            device,
            pendingToken: device?.pending_token ?? null,
            expiresAt: device?.pending_expires_at ?? null,
            requiresReplace: Boolean(device?.requires_replace),
            lastAccessToken: loginData.access,
          },
        },
      ],
    });
  }, [navigation]);

  const runLoginFlow = useCallback(async (credentials: LoginCredentials) => {
    setLoading(true);
    try {
      const initialResponse = await performLogin(credentials, { includeDeviceId: true });
      await handleLoginResponse(initialResponse, credentials);
      return;
    } catch (error) {
      if (error instanceof AuthenticationError && shouldRetryWithoutDevice(error.code)) {
        try {
          const fallbackResponse = await performLogin(credentials, { includeDeviceId: false });
          await handleLoginResponse(fallbackResponse, credentials);
          return;
        } catch (fallbackError) {
          if (fallbackError instanceof AuthenticationError) {
            // ترجمة رسالة "No active account found"
            const msg = fallbackError.message.toLowerCase().includes('no active account') 
              ? 'تأكد من المعلومات وحاول مجدداً' 
              : fallbackError.message;
            setErrorMessage(msg);
            return;
          }
          if (fallbackError instanceof Error) {
            // ترجمة رسالة "No active account found"
            const msg = fallbackError.message.toLowerCase().includes('no active account') 
              ? 'تأكد من المعلومات وحاول مجدداً' 
              : (fallbackError.message || 'تعذر تسجيل الدخول، حاول مرة أخرى');
            setErrorMessage(msg);
            return;
          }
          setErrorMessage('تعذر تسجيل الدخول، حاول مرة أخرى');
          return;
        }
      }

      if (error instanceof AuthenticationError) {
        // ترجمة رسالة "No active account found"
        const msg = error.message.toLowerCase().includes('no active account') 
          ? 'تأكد من المعلومات وحاول مجدداً' 
          : error.message;
        setErrorMessage(msg);
        return;
      }

      if (error instanceof Error) {
        // ترجمة رسالة "No active account found"
        const msg = error.message.toLowerCase().includes('no active account') 
          ? 'تأكد من المعلومات وحاول مجدداً' 
          : (error.message || 'تعذر تسجيل الدخول، حاول مرة أخرى');
        setErrorMessage(msg);
        return;
      }

      setErrorMessage('تعذر تسجيل الدخول، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  }, [handleLoginResponse]);

  const handleSubmit = useCallback(async () => {
    if (loading) {
      return;
    }

    const trimmedPassword = password.trim();
    setErrorMessage(null);

    if (useTeamLogin) {
      const owner = ownerUsername.trim();
      const team = teamUsername.trim();
      if (!owner || !team || !trimmedPassword) {
        setErrorMessage('الرجاء إدخال جميع الحقول المطلوبة');
        return;
      }
      await runLoginFlow({
        mode: 'team',
        ownerUsername: owner,
        teamUsername: team,
        password: trimmedPassword,
      });
      return;
    }

    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !trimmedPassword) {
      setErrorMessage('البريد الإلكتروني أو اسم المستخدم وكلمة المرور مطلوبة');
      return;
    }

    await runLoginFlow({
      mode: 'user',
      identifier: trimmedIdentifier,
      password: trimmedPassword,
    });
  }, [identifier, loading, ownerUsername, password, runLoginFlow, teamUsername, useTeamLogin]);

  const helperTextClass = cn('text-xs text-center mt-1', isDark ? 'text-[#94a3b8]' : 'text-[#857a72]');
  const policyLinkClass = cn('font-semibold', isDark ? 'text-[#34d399]' : 'text-[#2f9d73]');
  const displayedContactLinks = useMemo(() => contactLinks.slice(0, 10), [contactLinks]);
  const hasContactLinks = displayedContactLinks.length > 0;
  const pinButtonClass = cn(
    'h-[48px] rounded-[18px] border items-center justify-center flex-row',
    isDark ? 'border-[#34d399] bg-transparent' : 'border-[#2f9d73] bg-transparent',
  );
  const pinButtonTextClass = cn('text-sm font-semibold', isDark ? 'text-[#34d399]' : 'text-[#2f9d73]');

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

  const mapContactLinks = useCallback((items: ContactLinkDTO[]): ContactLinkView[] => {
    return items
      .map<ContactLinkView | null>((item) => {
        const href = normalizeContactHref(item.icon, item.value);
        if (!href) {
          return null;
        }
        const label = (item.label || '').trim();
        const iconDisplay = (item.icon_display || '').trim();
        const rawValue = (item.value || '').trim();
        const display = label || iconDisplay || rawValue || href;
        const subtitle = (() => {
          if (label && iconDisplay && iconDisplay !== label) {
            return iconDisplay;
          }
          if (rawValue && rawValue !== display) {
            return rawValue;
          }
          return undefined;
        })();
        const meta = CONTACT_ICON_META[item.icon] ?? DEFAULT_CONTACT_ICON_META;
        return {
          ...item,
          href,
          display,
          subtitle,
          meta,
        } satisfies ContactLinkView;
      })
      .filter((entry): entry is ContactLinkView => Boolean(entry));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const state = await inspectState();
          if (cancelled) {
            return;
          }
          setPinAvailable(state.hasSecureSession);
          const name = state.metadata?.displayName || state.metadata?.username || null;
          setPinDisplayName(name);
        } catch (error) {
          if (!cancelled) {
            console.warn('[Mutabaka] Failed to check PIN availability', error);
            setPinAvailable(false);
            setPinDisplayName(null);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handlePinLogin = useCallback(() => {
    if (!pinAvailable) {
      return;
    }
    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'PinUnlock',
          params: {
            intent: 'unlock',
            displayName: pinDisplayName,
          },
        },
      ],
    });
  }, [navigation, pinAvailable, pinDisplayName]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getContactLinks();
        if (!cancelled) {
          setContactLinks(mapContactLinks(data));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[Mutabaka] Failed to load contact links', error);
          setContactLinks([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapContactLinks]);

  const handleContactPress = useCallback(async (href: string) => {
    try {
      const supported = await Linking.canOpenURL(href);
      if (supported) {
        await Linking.openURL(href);
        return;
      }
      if (!href.startsWith('http')) {
        await Linking.openURL(`https://${href}`);
      }
    } catch (error) {
      console.warn('[Mutabaka] Failed to open contact link', { href, error });
    }
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
                      {pinAvailable ? (
                        <Pressable
                          onPress={handlePinLogin}
                          className={pinButtonClass}
                          accessibilityRole="button"
                        >
                          <Text className={pinButtonTextClass}>
                            الدخول باستخدام PIN{pinDisplayName ? ` (${pinDisplayName})` : ''}
                          </Text>
                        </Pressable>
                      ) : null}
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
                    {hasContactLinks ? (
                      <View className="items-center pt-3">
                        <View style={styles.contactIconRow}>
                          {displayedContactLinks.map((link) => {
                            const meta = CONTACT_ICON_META[link.icon] ?? DEFAULT_CONTACT_ICON_META;

                            return (
                              <View
                                key={link.id}
                                // الخلفية الدائرية والظل على الـ View الخارجي
                                style={[
                                  styles.contactIconTile,
                                  {
                                    backgroundColor: meta.backgroundColor, // ← هنا تتغير الخلفية فعليًا
                                    shadowColor: meta.shadowColor,
                                    shadowOpacity: 0.08,
                                    shadowRadius: 8,
                                    shadowOffset: { width: 0, height: 4 },
                                    elevation: 4,
                                  },
                                ]}
                              >
                                <Pressable
                                  onPress={() => handleContactPress(link.href)}
                                  accessibilityRole="link"
                                  accessibilityLabel={link.display}
                                  accessibilityHint={link.subtitle}
                                  android_ripple={{
                                    color: meta.rippleColor ?? 'rgba(0,0,0,0.08)',
                                    radius: CONTACT_TILE_RADIUS,
                                  }}
                                  style={({ pressed }) => [
                                    // لا خلفية هنا إطلاقًا؛ فقط تأثير الضغط
                                    { transform: [{ scale: pressed ? 0.96 : 1 }] },
                                  ]}
                                >
                                  {meta.renderIcon(
                                    CONTACT_ICON_SIZE,
                                    isDark ? meta.iconColorDark : meta.iconColorLight
                                  )}
                                </Pressable>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}

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
    paddingBottom: 32,
    paddingTop: 4,
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
  contactIconRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  contactIconTile: {
    width: CONTACT_TILE_SIZE,
    height: CONTACT_TILE_SIZE,
    borderRadius: CONTACT_TILE_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  modalErrorText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
