/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        // ~600ms flash on a slot when its secret reveals (U6 polish).
        revealFlash: {
          '0%':   { boxShadow: '0 0 0 0 rgba(125, 211, 252, 0.0)' },
          '30%':  { boxShadow: '0 0 0 4px rgba(125, 211, 252, 0.65)' },
          '100%': { boxShadow: '0 0 0 0 rgba(125, 211, 252, 0.0)' },
        },
        // Pulse on the token chip when the holder changes.
        tokenPulse: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.18)' },
        },
      },
      animation: {
        'reveal-flash': 'revealFlash 600ms ease-out 1',
        'token-pulse': 'tokenPulse 700ms ease-out 1',
      },
    },
  },
  plugins: [],
};
