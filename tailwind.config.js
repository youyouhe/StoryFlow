/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        desk: '#e5e5e5',
        'desk-dark': '#09090b',
        paper: '#ffffff',
        'paper-dark': '#18181b',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['Courier Prime', 'Courier', 'monospace'],
      },
      spacing: {
        '0': '0px',
        'px': '1px',
        ...Array.from({ length: 96 }, (_, i) => `${i + 1}`),
      },
    },
  },
  plugins: [],
}
