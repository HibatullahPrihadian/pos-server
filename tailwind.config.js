/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Mode desktop hanya bila layar lebar DAN pointer presisi (mouse/trackpad).
      // Perangkat sentuh (HP & tablet, termasuk tablet landscape besar) tetap
      // memakai layout HP walau lebarnya ≥1280, karena pointer-nya coarse.
      screens: {
        desk: { raw: '(min-width: 1280px) and (pointer: fine)' },
      },
      colors: {
        slate: {
          950: '#121212',
          900: '#1c1c1e',
          800: '#2c2c2e',
        },
        ios: {
          blue: '#0a84ff',
          green: '#30d158',
          orange: '#ff9f0a',
          purple: '#bf5af2',
          red: '#ff453a',
          cyan: '#64d2ff',
          pink: '#ff375f',
          yellow: '#ffd60a',
          gray: '#8e8e93',
          gray2: '#aeaeb2',
        },
      },
      boxShadow: {
        glass: '0 10px 40px rgba(0,0,0,0.3)',
        'glow-blue': '0 6px 20px rgba(10,132,255,0.5)',
        'glow-green': '0 6px 20px rgba(48,209,88,0.5)',
        'glow-red': '0 6px 20px rgba(255,69,58,0.5)',
        'glow-orange': '0 6px 20px rgba(255,159,10,0.5)',
        'glow-purple': '0 6px 20px rgba(191,90,242,0.5)',
        'glow-blue-soft': '0 0 0 3px rgba(10,132,255,0.3)',
      },
      backdropBlur: {
        glass: '24px',
      },
      borderRadius: {
        ios: '24px',
        'ios-sm': '12px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
