/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './screens/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './storage/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  safelist: ['ui-toast-error', 'ui-toast-success', 'ui-toast-info'],
  theme: {
    extend: {
      fontFamily: { sans: ['Manrope Variable', 'sans-serif'] },
      colors: {
        blue: {
          50: '#edf2ff',
          100: '#dce5ff',
          200: '#b9ccff',
          300: '#93adff',
          400: '#698aef',
          500: '#4c73ed',
          600: '#315ce7',
          700: '#244bd0',
          800: '#2543a4',
          900: '#243969',
          950: '#152136',
        },
        stone: {
          50: '#f9fafc',
          100: '#f1f4f8',
          200: '#e5eaf1',
          300: '#ccd5e2',
          400: '#98a5b8',
          500: '#718096',
          600: '#536279',
          700: '#3e4e65',
          800: '#27384e',
          900: '#172333',
          950: '#101b2d',
        },
      },
    },
  },
  plugins: [],
};
