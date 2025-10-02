import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, Platform, type KeyboardTypeOptions } from 'react-native';

export type PinCodeInputStatus = 'default' | 'error' | 'success';

export interface PinCodeInputHandle {
  focus: () => void;
  blur: () => void;
  clear: () => void;
}

export interface PinCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  status?: PinCodeInputStatus;
  label?: string;
  helperText?: string;
  autoFocus?: boolean;
  onFilled?: (value: string) => void;
  isDark?: boolean;
}

const DIGIT_PLACEHOLDER = '•';

function sanitize(text: string, max: number): string {
  return text.replace(/[^0-9]/g, '').slice(0, max);
}

const PinCodeInput = forwardRef<PinCodeInputHandle, PinCodeInputProps>((props, ref) => {
  const {
    value,
    onChange,
    length = 6,
    disabled = false,
    status = 'default',
    label,
    helperText,
    autoFocus = false,
    onFilled,
    isDark = false,
  } = props;

  const inputRef = useRef<TextInput | null>(null);
  const lastFilledValueRef = useRef<string>('');
  const keyboardType = useMemo<KeyboardTypeOptions>(() => (
    Platform.OS === 'android' ? 'numeric' : 'number-pad'
  ), []);

  const colors = useMemo(() => {
    if (isDark) {
      return {
        text: '#f8fafc',
        muted: '#64748b',
        container: '#0b141a',
        boxBorder: '#1f2937',
        boxBackground: '#0f172a',
        activeBorder: '#34d399',
        errorBorder: '#f87171',
        helper: '#94a3b8',
      } as const;
    }
    return {
      text: '#111827',
      muted: '#94a3b8',
      container: '#fff9f3',
      boxBorder: '#e2e8f0',
      boxBackground: '#ffffff',
      activeBorder: '#2f9d73',
      errorBorder: '#dc2626',
      helper: '#6b7280',
    } as const;
  }, [isDark]);

  const handlePress = useCallback(() => {
    if (disabled) {
      return;
    }
    inputRef.current?.focus();
  }, [disabled]);

  const handleChangeText = useCallback((text: string) => {
    const sanitized = sanitize(text, length);
    onChange(sanitized);
  }, [length, onChange]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!disabled) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    blur: () => {
      inputRef.current?.blur();
    },
    clear: () => {
      onChange('');
    },
  }), [disabled, onChange]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const id = requestAnimationFrame(() => {
      if (!disabled) {
        inputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (!onFilled) {
      return;
    }
    if (value.length === length && value !== lastFilledValueRef.current) {
      lastFilledValueRef.current = value;
      onFilled(value);
    }
    if (value.length < length) {
      lastFilledValueRef.current = '';
    }
  }, [length, onFilled, value]);

  const boxes = useMemo(() => {
    return Array.from({ length }).map((_, index) => {
      const digit = value[index];
      const isActive = index === value.length && value.length < length;
      const isFilled = typeof digit === 'string' && digit.length > 0;
      const baseBorderColor = status === 'error'
        ? colors.errorBorder
        : isActive
          ? colors.activeBorder
          : colors.boxBorder;
      return (
        <View
          key={`pin-box-${index}`}
          style={[
            styles.digitBox,
            {
              borderColor: baseBorderColor,
              backgroundColor: colors.boxBackground,
            },
          ]}
        >
          <Text style={[styles.digitText, { color: colors.text }]}>
            {isFilled ? DIGIT_PLACEHOLDER : ''}
          </Text>
        </View>
      );
    });
  }, [colors.activeBorder, colors.boxBackground, colors.boxBorder, colors.errorBorder, colors.text, length, status, value]);

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      ) : null}
      <Pressable onPress={handlePress} style={[styles.pressable, { opacity: disabled ? 0.6 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={label ?? 'إدخال رمز PIN'}
      >
        <View style={[styles.digitsRow, { backgroundColor: colors.container }]}
        >
          {boxes}
        </View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={handleChangeText}
          keyboardType={keyboardType}
          inputMode="numeric"
          secureTextEntry
          caretHidden
          maxLength={length}
          editable={!disabled}
          style={styles.hiddenInput}
          textContentType="oneTimeCode"
        />
      </Pressable>
      {helperText ? (
        <Text style={[styles.helperText, { color: status === 'error' ? colors.errorBorder : colors.helper }]}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
});

PinCodeInput.displayName = 'PinCodeInput';

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
  },
  pressable: {
    width: '100%',
  },
  digitsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 22,
    gap: 8,
  },
  digitBox: {
    width: 44,
    height: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitText: {
    fontSize: 24,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 0,
    width: 0,
  },
});

export default PinCodeInput;
