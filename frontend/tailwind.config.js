/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/app/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        chatBg: 'rgb(var(--color-chat-bg) / <alpha-value>)',
        chatPanel: 'rgb(var(--color-chat-panel) / <alpha-value>)',
        chatDivider: 'rgb(var(--color-chat-divider) / <alpha-value>)',
        bubbleSent: 'rgb(var(--color-bubble-sent) / <alpha-value>)',
        bubbleReceived: 'rgb(var(--color-bubble-received) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};