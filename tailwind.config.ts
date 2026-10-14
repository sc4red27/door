import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        heading: 'hsl(var(--heading))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          ink: 'hsl(var(--primary-ink))',
        },
        highlight: {
          DEFAULT: 'hsl(var(--highlight))',
          soft: 'hsl(var(--highlight-soft))',
          foreground: 'hsl(var(--highlight-foreground))',
        },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        mark: 'hsl(var(--mark))',
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 6px)',
      },
      // Delicate, navy-tinted shadows; never heavier than this.
      boxShadow: {
        sm: '0 1px 2px hsl(222 37% 19% / 0.04), 0 1px 1px hsl(222 37% 19% / 0.02)',
        DEFAULT: '0 1px 2px hsl(222 37% 19% / 0.04), 0 4px 12px -2px hsl(222 37% 19% / 0.05)',
        md: '0 2px 4px hsl(222 37% 19% / 0.04), 0 8px 24px -6px hsl(222 37% 19% / 0.08)',
        lg: '0 -1px 0 hsl(222 37% 19% / 0.03), 0 -8px 24px -12px hsl(222 37% 19% / 0.10)',
      },
      // System font stack: zero font bytes on the wire, good Hangul rendering on every OS.
      fontFamily: {
        sans: [
          'Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'Apple SD Gothic Neo',
          'Malgun Gothic', 'Segoe UI', 'Roboto', 'Noto Sans KR', 'system-ui', 'sans-serif',
        ],
      },
      keyframes: { shimmer: { '100%': { transform: 'translateX(100%)' } } },
      animation: { shimmer: 'shimmer 1.6s infinite' },
    },
  },
  plugins: [],
};

export default config;
