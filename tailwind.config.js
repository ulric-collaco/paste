import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0f0f23',
          800: '#1a1a2e',
          700: '#25253a',
          600: '#2d2d42',
          500: '#3a3a4f',
        }
      }
    },
  },
  plugins: [
    typography,
  ],
}
