import { forwardRef, type ElementRef } from 'react';
import { Pressable, Text, type PressableProps } from 'react-native';
import { useThemeMode } from '../theme';
import { cn } from '../utils/cn';

export type BrandButtonVariant = 'primary' | 'secondary' | 'ghost';

interface BrandButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: BrandButtonVariant;
  className?: string;
}

const BrandButton = forwardRef<ElementRef<typeof Pressable>, BrandButtonProps>((
  { title, variant = 'primary', className, ...rest },
  ref,
) => {
  const { mode, tokens } = useThemeMode();

  const baseClasses = 'rounded-2xl px-4 py-3 items-center justify-center';
  const variantClasses = (() => {
    if (variant === 'secondary') {
      return mode === 'light'
        ? 'bg-chatPanelLight border border-chatDividerLight shadow-panel'
        : 'bg-chatPanelDark border border-chatDividerDark';
    }
    if (variant === 'ghost') {
      return mode === 'light'
        ? 'bg-transparent border border-transparent'
        : 'bg-transparent border border-transparent';
    }
    return mode === 'light'
      ? 'bg-brandGreen text-white shadow-panel'
      : 'bg-brandGreenDark text-white';
  })();

  const textClasses = 'text-base font-semibold';
  const textColor = variant === 'secondary'
    ? (mode === 'light' ? tokens.textPrimary : tokens.textPrimary)
    : '#ffffff';

  return (
    <Pressable ref={ref} className={cn(baseClasses, variantClasses, className)} {...rest}>
      <Text className={textClasses} style={{ color: textColor }}>
        {title}
      </Text>
    </Pressable>
  );
});

export default BrandButton;
