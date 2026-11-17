/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg-base)",
        foreground: "var(--text-primary)",
        surface: {
          DEFAULT: "var(--bg-panel)",
          raised: "var(--bg-elevated)",
          hover: "var(--bg-hover)",
        },
        border: {
          DEFAULT: "var(--border-subtle)",
          hover: "var(--border-strong)",
        },
        muted: {
          DEFAULT: "var(--bg-elevated)",
          foreground: "var(--text-secondary)",
        },
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-contrast)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          dim: "var(--accent-dim)",
        },
        tertiary: "var(--text-tertiary)",
        danger: "var(--danger)",
        /* easyui's own naming (text-text-primary & friends) */
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-tertiary)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI",
          "Microsoft YaHei UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Cascadia Mono", "Consolas", "monospace"],
      },
      fontSize: {
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["12px", { lineHeight: "17px" }],
        base: ["13px", { lineHeight: "19px" }],
        lg: ["15px", { lineHeight: "21px" }],
        xl: ["18px", { lineHeight: "24px" }],
      },
      fontWeight: {
        normal: "400",
        medium: "500",
      },
      borderRadius: {
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
      },
      boxShadow: {
        float: "var(--win-shadow)",
      },
      transitionDuration: {
        DEFAULT: "120ms",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        breathe: "breathe 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
