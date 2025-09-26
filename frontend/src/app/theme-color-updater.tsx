'use client';

import { useEffect } from 'react';
import { useThemeMode } from './theme-context';

const LIGHT_THEME_COLOR = '#FFFFFF';
const DARK_THEME_COLOR = '#111B21';

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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const appleMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleMeta instanceof HTMLMetaElement) {
      appleMeta.setAttribute('content', theme === 'dark' ? 'black' : 'default');
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const registerSw = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      registerSw();
      return;
    }

    const onLoad = () => {
      registerSw();
    };

    window.addEventListener('load', onLoad, { once: true });
    return () => {
      window.removeEventListener('load', onLoad);
    };
  }, []);

  return null;
}
