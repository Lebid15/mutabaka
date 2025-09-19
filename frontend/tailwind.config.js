/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/app/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        chatBg: '#0b141a',
        chatPanel: '#111b21',
        chatDivider: '#233138',
        bubbleSent: '#005c4b',
        bubbleReceived: '#202c33',
      },
    },
  },
  plugins: [],
};