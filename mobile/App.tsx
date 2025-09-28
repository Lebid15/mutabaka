import 'react-native-gesture-handler';
import './global.css';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nManager, type ViewStyle } from 'react-native';
import RootNavigator from './src/navigation';
import { ThemeProvider, useThemeMode } from './src/theme';

I18nManager.allowRTL(true);
I18nManager.swapLeftAndRightInRTL(true);

function AppContainer() {
  const { mode, tokens } = useThemeMode();

  console.log('[Mutabaka] AppContainer mounted with mode:', mode);

  return (
    <>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} backgroundColor={tokens.background} />
      <RootNavigator />
    </>
  );
}

export default function App() {
  const rtlLayout: ViewStyle = { flex: 1, direction: 'rtl' };

  return (
    <GestureHandlerRootView style={rtlLayout}>
      <ThemeProvider>
        <SafeAreaProvider style={rtlLayout}>
          <AppContainer />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
