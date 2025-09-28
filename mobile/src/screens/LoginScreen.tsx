import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FeatherIcon from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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

  const isDark = mode === 'dark';

  const cardClasses = cn(
    'w-full max-w-[420px] rounded-[28px] p-10 pt-14 gap-8 border',
    isDark ? 'bg-[#111b21]/95 border-[#233138]' : 'bg-white/85 border-[#f8ddc8]/90',
  );

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

  const headlineClass = cn('text-[28px] font-black leading-[34px] text-center tracking-tight', isDark ? 'text-white' : 'text-[#2d241a]');
  const helperTextClass = cn('text-xs text-center mt-1', isDark ? 'text-[#94a3b8]' : 'text-[#857a72]');

  const iconColor = isDark ? '#9ca3af' : '#f5a34b';
  const placeholderColor = isDark ? '#94a3b8' : '#9ca3af';

  const cardShadowStyle = useMemo(() => ({
    shadowColor: isDark ? '#000000' : '#ff9933',
    shadowOpacity: isDark ? 0.35 : 0.35,
    shadowRadius: isDark ? 28 : 32,
    shadowOffset: { width: 0, height: isDark ? 22 : 26 },
    elevation: 18,
  }), [isDark]);

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

  return (
    <BackgroundGradient>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-8 pb-12">
            <View className="items-end">
              <ThemeToggle />
            </View>
            <View className="flex-1 items-center justify-center" collapsable={false}>
              <View className="w-full max-w-[420px] items-center">
                {glowGradient}
                <View className={cardClasses} style={cardShadowStyle}>
                  <View className="items-center">
                    <SvgXml xml={logoDefault} width={150} height={150} />
                  </View>

                  <View className="gap-2">
                    <Text className={headlineClass}>مرحباً بعودتك</Text>
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
                      بتسجيل الدخول فإنك توافق على شروط الاستخدام وسياسة الخصوصية.
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BackgroundGradient>
  );
}
