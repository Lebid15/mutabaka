import { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import { useThemeMode } from '../theme';
import { cn } from '../utils/cn';

interface BackgroundGradientProps {
  children: ReactNode;
  className?: string;
}

export default function BackgroundGradient({ children, className }: BackgroundGradientProps) {
  const { mode } = useThemeMode();

  const colors = mode === 'light'
    ? ['#fffdf8', '#fff1de', '#ffe1c8'] as const
    : ['#04111d', '#0a1f2d', '#050d18'] as const;

  const accentOverlay = mode === 'light'
    ? ['transparent', 'transparent'] as const
    : ['rgba(8, 47, 73, 0.75)', 'rgba(4, 17, 29, 0.25)', 'rgba(8, 47, 73, 0)'] as const;

  return (
    <LinearGradient style={{ flex: 1 }} colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <LinearGradient
        colors={accentOverlay}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <View className={cn('flex-1', className)}>{children}</View>
      </LinearGradient>
    </LinearGradient>
  );
}
