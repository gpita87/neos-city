/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        neos: {
          bg:        '#050a18',   // deep space navy
          surface:   '#0c1425',   // card/panel surface
          border:    '#1a2744',   // subtle blue border
          accent:    '#00e5ff',   // neon cyan — the Neos City glow
          purple:    '#a855f7',   // neon violet
          pink:      '#ff3d8f',   // electric pink
          gold:      '#f59e0b',
          red:       '#ef4444',
          teal:      '#14b8a6',
        }
      },
      boxShadow: {
        'neon-cyan':   '0 0 15px rgba(0,229,255,0.3), 0 0 40px rgba(0,229,255,0.1)',
        'neon-purple': '0 0 15px rgba(168,85,247,0.3), 0 0 40px rgba(168,85,247,0.1)',
        'neon-pink':   '0 0 15px rgba(255,61,143,0.3)',
        'neon-sm':     '0 0 8px rgba(0,229,255,0.2)',
      },
      animation: {
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        'neon-flicker': 'neon-flicker 4s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
        'neon-flicker': {
          '0%, 100%': { textShadow: '0 0 10px rgba(0,229,255,0.5), 0 0 20px rgba(0,229,255,0.3)' },
          '50%': { textShadow: '0 0 15px rgba(0,229,255,0.8), 0 0 30px rgba(0,229,255,0.4), 0 0 50px rgba(0,229,255,0.2)' },
        },
      },
    }
  },
  plugins: []
};
