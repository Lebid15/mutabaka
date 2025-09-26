'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeMode;
  isLight: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEYS = ['appTheme', 'loginTheme'] as const;

function readStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  for (const key of STORAGE_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value === 'light' || value === 'dark') return value;
    } catch {
      /* ignore */
    }
  }
  try {
    const match = document.cookie.match(/(?:^|; )app-theme=(light|dark)(?:;|$)/);
    if (match && (match[1] === 'light' || match[1] === 'dark')) {
      return match[1] as ThemeMode;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function detectPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
}

export function ThemeProvider({ children, defaultTheme }: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (defaultTheme === 'light' || defaultTheme === 'dark') {
      return defaultTheme;
    }
    const stored = readStoredTheme();
    return stored ?? detectPreferredTheme();
  });

  useEffect(() => {
    const stored = readStoredTheme();
    if (stored && stored !== theme) {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
    }
    try {
      for (const key of STORAGE_KEYS) {
        window.localStorage.setItem(key, theme);
      }
      document.cookie = `app-theme=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }, [theme]);

  const contextValue = useMemo<ThemeContextValue>(() => ({
    theme,
    isLight: theme === 'light',
    setTheme,
    toggleTheme: () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light')),
  }), [theme]);

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within a ThemeProvider');
  }
  return ctx;
}
