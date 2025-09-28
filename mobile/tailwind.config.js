/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        chatBgLight: '#fff9f4',
        chatBgDark: '#0b141a',
        chatPanelLight: '#ffffff',
        chatPanelDark: '#111b21',
        chatDividerLight: '#f8ddc8',
        chatDividerDark: '#233138',
        bubbleSentLight: '#ffbc78',
        bubbleSentDark: '#005c4b',
        bubbleReceivedLight: '#ffecdC',
        bubbleReceivedDark: '#202c33',
        brandGreen: '#2f9d73',
        brandGreenDark: '#15803d',
        brandAmber: '#ffb066',
        brandRose: '#ef5350',
        textBrown: '#3c3127',
        textBrownMuted: '#6b6057',
        textLight: '#e2e8f0',
        textMuted: '#94a3b8',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        brand: '0 35px 60px -15px rgba(255, 153, 51, 0.35)',
        panel: '0 25px 50px -12px rgba(255, 176, 102, 0.2)',
      },
    },
  },
  plugins: [],
};
