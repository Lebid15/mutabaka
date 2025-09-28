import FeatherIcon from '@expo/vector-icons/Feather';
import { Pressable } from 'react-native';
import { useThemeMode } from '../theme';
import { cn } from '../utils/cn';

export default function ThemeToggle() {
  const { mode, toggleTheme } = useThemeMode();

  const iconName = mode === 'light' ? 'moon' : 'sun';
  const iconColor = mode === 'light' ? '#f97316' : '#fde68a';

  return (
    <Pressable
      onPress={toggleTheme}
      className={cn(
        'w-11 h-11 rounded-full items-center justify-center border',
        mode === 'light'
          ? 'bg-white/70 border-[#f8ddc8] shadow-panel'
          : 'bg-[#0f1b22]/80 border-[#233138] shadow-lg',
      )}
    >
      <FeatherIcon name={iconName} size={20} color={iconColor} />
    </Pressable>
  );
}
