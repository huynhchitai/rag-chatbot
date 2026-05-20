import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        canvas: "#FFFFFF",
        surface: "#FAFAFA",
        surface2: "#F4F4F5",
        ink: "#0A0A0A",
        ink2: "#262626",
        muted: "#525252",
        mute2: "#A1A1AA",
        line: "#E5E5E5",
        line2: "#D4D4D8",
        accent: "#FF6B00",
        accentSoft: "#FFE4D1",
        accentDim: "#CC5600",
        live: "#16A34A",
        liveSoft: "#DCFCE7",
        warn: "#D97706",
        warnSoft: "#FEF3C7",
        danger: "#DC2626",
        dangerSoft: "#FEE2E2",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(10,10,10,0.04), 0 1px 2px rgba(10,10,10,0.02)",
        lift: "0 4px 14px rgba(10,10,10,0.06), 0 2px 4px rgba(10,10,10,0.03)",
        ring: "0 0 0 4px rgba(255,107,0,0.12)",
      },
      borderRadius: {
        DEFAULT: "0.5rem",
      },
      fontSize: {
        "display-1": ["clamp(2.5rem, 6vw, 4.5rem)", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-2": ["clamp(1.875rem, 4vw, 3rem)", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
      },
    },
  },
  plugins: [],
};

export default config;
