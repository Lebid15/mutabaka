export type ThemeMode = 'light' | 'dark';

export interface ThemeTokens {
  background: string;
  panel: string;
  panelAlt: string;
  divider: string;
  bubbleSent: string;
  bubbleReceived: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  success: string;
  danger: string;
  shadow: string;
}

export const lightTokens: ThemeTokens = {
  background: '#fff9f4',
  panel: '#ffffff',
  panelAlt: '#fff3e4',
  divider: '#f8ddc8',
  bubbleSent: '#ffbc78',
  bubbleReceived: '#ffe6dc',
  textPrimary: '#3c3127',
  textSecondary: '#6b6057',
  textMuted: '#9e948d',
  accent: '#ffb066',
  accentSoft: '#ffe7cb',
  accentStrong: '#c2410c',
  success: '#2f9d73',
  danger: '#ef5350',
  shadow: 'rgba(255, 176, 102, 0.22)',
};

export const darkTokens: ThemeTokens = {
  background: '#0b141a',
  panel: '#111b21',
  panelAlt: '#0e1b22',
  divider: '#233138',
  bubbleSent: '#005c4b',
  bubbleReceived: '#202c33',
  textPrimary: '#e2e8f0',
  textSecondary: '#cbd5f5',
  textMuted: '#94a3b8',
  accent: '#22c55e',
  accentSoft: '#1f2937',
  accentStrong: '#fb7185',
  success: '#22c55e',
  danger: '#f87171',
  shadow: 'rgba(15, 23, 42, 0.35)',
};

export const TOKENS: Record<ThemeMode, ThemeTokens> = {
  light: lightTokens,
  dark: darkTokens,
};
