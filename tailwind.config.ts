import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Custom theme colors
        "deep-blue": {
          DEFAULT: "#1e3a5f",
          50: "#e8eef5",
          100: "#c5d5e8",
          200: "#9eb8d8",
          300: "#779bc8",
          400: "#5a84bc",
          500: "#3d6eb0",
          600: "#2f5a97",
          700: "#1e3a5f",
          800: "#162c49",
          900: "#0d1e33",
        },
        purple: {
          DEFAULT: "#6b46c1",
          50: "#f3f0fa",
          100: "#e0d9f5",
          200: "#c4b4ec",
          300: "#a98ee2",
          400: "#9270db",
          500: "#7c55d3",
          600: "#6b46c1",
          700: "#5a38a6",
          800: "#472d87",
          900: "#352168",
        },
        emerald: {
          DEFAULT: "#059669",
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        aqua: {
          DEFAULT: "#0891b2",
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        japanese: ['"M PLUS 1"', "system-ui", "sans-serif"],
        serif: ['"PT Serif"', "Georgia", "serif"],
        sans: ['"M PLUS 1"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
      },
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, #1e3a5f 0%, #6b46c1 100%)",
        "gradient-aqua": "linear-gradient(135deg, #0891b2 0%, #059669 100%)",
        "gradient-hero": "linear-gradient(135deg, #1e3a5f 0%, #6b46c1 50%, #0891b2 100%)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
