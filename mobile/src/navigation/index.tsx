import { NavigationContainer, DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationLightTheme, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import ChatScreen from '../screens/ChatScreen';
import BootstrapScreen from '../screens/BootstrapScreen';
import DevicePendingScreen from '../screens/DevicePendingScreen';
import HomeScreen from '../screens/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import MatchesScreen from '../screens/MatchesScreen';
import PinSetupScreen from '../screens/PinSetupScreen';
import PinUnlockScreen from '../screens/PinUnlockScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RefreshContactsScreen from '../screens/RefreshContactsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SubscriptionsScreen from '../screens/SubscriptionsScreen';
import TeamScreen from '../screens/TeamScreen';
import QADevicesScreen from '../screens/QADevicesScreen';
import { useThemeMode } from '../theme';
import type { AuthTokens } from '../lib/authStorage';
import type { PinStatusPayload } from '../lib/pinSession';
import type { LoginCredentials } from '../services/auth';
import type { LinkedDevice } from '../services/devices';
import { isQaBuild } from '../utils/qa';
import { useNotificationHandlers } from '../hooks/useNotificationHandlers';

export type RootStackParamList = {
  Bootstrap: undefined;
  Login: undefined;
  PinUnlock: { intent?: 'unlock' | 'change'; displayName?: string | null } | undefined;
  PinSetup: {
    userId: number;
    tokens: AuthTokens;
    pinStatus: PinStatusPayload;
    displayName?: string | null;
    username?: string | null;
    mode?: 'initial' | 'change';
  };
  Home: undefined;
  Chat: { conversationId: string };
  Profile: undefined;
  Matches: undefined;
  Settings: undefined;
  Subscriptions: undefined;
  Team: undefined;
  RefreshContacts: undefined;
  DevicePending: {
    credentials: LoginCredentials;
    device: LinkedDevice;
    pendingToken: string | null;
    expiresAt: string | null;
    requiresReplace: boolean;
    lastAccessToken: string;
  };
  QADevices?: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { mode, tokens } = useThemeMode();
  const qaEnabled = isQaBuild();
  
  // إعداد معالجات الإشعارات (التنقل للمحادثة عند الضغط على إشعار)
  useNotificationHandlers();

  const theme = useMemo(() => {
    const base = mode === 'light' ? NavigationLightTheme : NavigationDarkTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: tokens.background,
        card: tokens.panel,
        text: tokens.textPrimary,
        border: tokens.divider,
      },
    };
  }, [mode, tokens]);

  const linking = useMemo<LinkingOptions<RootStackParamList> | undefined>(() => {
    if (!qaEnabled) {
      return undefined;
    }
    return {
      prefixes: ['qa://'],
      config: {
        screens: {
          QADevices: 'devices',
        },
      },
    };
  }, [qaEnabled]);

  return (
    <NavigationContainer theme={theme} linking={linking}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Bootstrap">
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
  <Stack.Screen name="DevicePending" component={DevicePendingScreen} />
        <Stack.Screen name="PinUnlock" component={PinUnlockScreen} />
        <Stack.Screen name="PinSetup" component={PinSetupScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Matches" component={MatchesScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Subscriptions" component={SubscriptionsScreen} />
        <Stack.Screen name="Team" component={TeamScreen} />
        <Stack.Screen name="RefreshContacts" component={RefreshContactsScreen} />
        {qaEnabled ? <Stack.Screen name="QADevices" component={QADevicesScreen} /> : null}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
