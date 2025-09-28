import { forwardRef, type ElementRef } from 'react';
import { Text, TextInput, type TextInputProps, View } from 'react-native';
import { useThemeMode } from '../theme';
import { cn } from '../utils/cn';

interface InputFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  className?: string;
}

const InputField = forwardRef<ElementRef<typeof TextInput>, InputFieldProps>(
  ({ label, hint, className, ...rest }, ref) => {
    const { mode, tokens } = useThemeMode();
    const base = 'w-full rounded-2xl px-4 py-3 text-base font-medium';
    const lightClasses = 'bg-white/90 border border-[#f1c59c] text-[#3d3227]';
    const darkClasses = 'bg-chatPanelDark border border-chatDividerDark text-textLight';

    return (
      <View className="w-full gap-2">
        {label ? (
          <Text
            className={cn('text-xs font-semibold tracking-wide uppercase', mode === 'light' ? 'text-textBrownMuted' : 'text-textMuted')}
          >
            {label}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          className={cn(base, mode === 'light' ? lightClasses : darkClasses, className)}
          placeholderTextColor={mode === 'light' ? tokens.textMuted : '#64748b'}
          {...rest}
        />
        {hint ? (
          <Text className={cn('text-xs', mode === 'light' ? 'text-textBrownMuted' : 'text-textMuted')}>
            {hint}
          </Text>
        ) : null}
      </View>
    );
  },
);

export default InputField;
