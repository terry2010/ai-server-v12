/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F3F4F6',
        foreground: '#111827',
        muted: '#6B7280',
        primary: {
          DEFAULT: '#007AFF',
          foreground: '#ffffff',
        },
        warning: {
          DEFAULT: '#FF9500',
          foreground: '#111827',
        },
        destructive: {
          DEFAULT: '#FF3B30',
          foreground: '#ffffff',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'SF Mono',
          'Cascadia Code',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        glass: '0 20px 45px rgba(15, 23, 42, 0.18)',
      },
      keyframes: {
        'status-error': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'status-error': 'status-error 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
