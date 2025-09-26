'use client';

import { useEffect } from 'react';
import { useThemeMode } from './theme-context';

const LIGHT_THEME_COLOR = '#0A2E6D';
const DARK_THEME_COLOR = '#0A2E6D';

export default function ThemeColorUpdater() {
  const { theme } = useThemeMode();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    const color = theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
    metas.forEach((meta) => {
      if (meta instanceof HTMLMetaElement && !meta.getAttribute('media')) {
        meta.setAttribute('content', color);
      }
    });
  }, [theme]);

  return null;
}
