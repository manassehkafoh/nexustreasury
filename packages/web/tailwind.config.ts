import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nexus: {
          bg:      '#030C1B',
          surface: '#071827',
          deep:    '#0C2038',
          gold:    '#D4A843',
          'gold-light': '#F0CA6A',
          teal:    '#00C896',
          blue:    '#3D8BF0',
          red:     '#EF4060',
          muted:   '#6882A8',
          dim:     '#243558',
        },
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans:  ['DM Sans', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-beat':  'glowBeat 2s ease-in-out infinite',
      },
      keyframes: {
        glowBeat: {
          '0%, 100%': { opacity: '0.55' },
          '50%':      { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
