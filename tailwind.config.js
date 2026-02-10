/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./contexts/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./data/**/*.{js,ts,jsx,tsx}",
    "./App.tsx",
    "./index.tsx"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        brand: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        money: {
          pos: '#10B981',
          neg: '#F43F5E',
          bgPos: '#ECFDF5',
          bgNeg: '#FFF1F2',
        },
        habit: {
          streak: '#F97316',
          gold: '#FBBF24',
          blue: '#60A5FA',
        },
      },
      borderRadius: {
        card: '1rem',
        btn: '0.75rem',
      },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        glass: '0 8px 30px rgba(0, 0, 0, 0.04)',
        nav: '0 -10px 40px -15px rgba(0, 0, 0, 0.05)',
        'btn-primary': '0 1px 2px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.1)',
        'btn-primary-hover': '0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.1)',
        'btn-secondary': '0 1px 2px rgba(0,0,0,0.05)',
        'btn-success': '0 1px 2px var(--tw-shadow-color), inset 0 1px 0 rgba(255,255,255,0.1)',
        'btn-warning': '0 1px 2px var(--tw-shadow-color), inset 0 1px 0 rgba(255,255,255,0.1)',
        'btn-destructive': '0 1px 2px var(--tw-shadow-color), inset 0 1px 0 rgba(255,255,255,0.1)',
      },
      spacing: {
        'safe': 'env(safe-area-inset-bottom)',
      },
      fontSize: {
        xxs: '10px',
      },
      zIndex: {
        sticky: '40',
        dropdown: '50',
        modal: '60',
        popover: '70',
        banner: '55',
        toast: '110',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },
    },
  },
  plugins: [],
}
