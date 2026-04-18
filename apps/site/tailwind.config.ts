import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../../packages/shared/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        phosphor: {
          50: "#e9ffe7",
          100: "#d2ffd0",
          300: "#8df48d",
          500: "#47e65b",
          700: "#1da13a",
          900: "#0c2511"
        }
      },
      boxShadow: {
        phosphor: "0 0 30px rgba(71, 230, 91, 0.18)"
      },
      animation: {
        flicker: "flicker 6s steps(120, end) infinite",
        drift: "drift 18s linear infinite",
        pulsegrid: "pulsegrid 2.8s ease-in-out infinite"
      },
      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "0.96" },
          "8%": { opacity: "0.88" },
          "12%": { opacity: "0.98" },
          "40%": { opacity: "0.9" },
          "42%": { opacity: "0.97" },
          "64%": { opacity: "0.92" },
          "66%": { opacity: "0.99" }
        },
        drift: {
          from: { transform: "translate3d(0, 0, 0)" },
          to: { transform: "translate3d(0, -40%, 0)" }
        },
        pulsegrid: {
          "0%, 100%": { opacity: "0.06" },
          "50%": { opacity: "0.12" }
        }
      }
    }
  },
  plugins: []
};

export default config;

