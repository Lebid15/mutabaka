import { NavigationContainer, DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationLightTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import ChatScreen from '../screens/ChatScreen';
import HomeScreen from '../screens/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import MatchesScreen from '../screens/MatchesScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RefreshContactsScreen from '../screens/RefreshContactsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SubscriptionsScreen from '../screens/SubscriptionsScreen';
import TeamScreen from '../screens/TeamScreen';
import { useThemeMode } from '../theme';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Chat: { conversationId: string };
  Profile: undefined;
  Matches: undefined;
  Settings: undefined;
  Subscriptions: undefined;
  Team: undefined;
  RefreshContacts: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { mode, tokens } = useThemeMode();

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

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Matches" component={MatchesScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Subscriptions" component={SubscriptionsScreen} />
        <Stack.Screen name="Team" component={TeamScreen} />
        <Stack.Screen name="RefreshContacts" component={RefreshContactsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
