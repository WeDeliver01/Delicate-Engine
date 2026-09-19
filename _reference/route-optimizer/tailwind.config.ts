import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
        surface: {
          base: "hsl(var(--v7-surface-base) / <alpha-value>)",
          raised: "hsl(var(--v7-surface-raised) / <alpha-value>)",
          overlay: "hsl(var(--v7-surface-overlay) / <alpha-value>)",
          inset: "hsl(var(--v7-surface-inset) / <alpha-value>)",
        },
        hairline: "hsl(var(--v7-border-hairline) / <alpha-value>)",
        "border-soft": "hsl(var(--v7-border-soft) / <alpha-value>)",
        "border-strong": "hsl(var(--v7-border-strong) / <alpha-value>)",
        text: {
          primary: "hsl(var(--v7-text-primary) / <alpha-value>)",
          secondary: "hsl(var(--v7-text-secondary) / <alpha-value>)",
          tertiary: "hsl(var(--v7-text-tertiary) / <alpha-value>)",
          quiet: "hsl(var(--v7-text-quiet) / <alpha-value>)",
        },
        ivory: "hsl(var(--v7-text-primary) / <alpha-value>)",
        jacaranda: {
          DEFAULT: "hsl(var(--v7-jacaranda-500) / <alpha-value>)",
          50: "hsl(var(--v7-jacaranda-50) / <alpha-value>)",
          100: "hsl(var(--v7-jacaranda-100) / <alpha-value>)",
          200: "hsl(var(--v7-jacaranda-200) / <alpha-value>)",
          300: "hsl(var(--v7-jacaranda-300) / <alpha-value>)",
          400: "hsl(var(--v7-jacaranda-400) / <alpha-value>)",
          500: "hsl(var(--v7-jacaranda-500) / <alpha-value>)",
          600: "hsl(var(--v7-jacaranda-600) / <alpha-value>)",
          700: "hsl(var(--v7-jacaranda-700) / <alpha-value>)",
          800: "hsl(var(--v7-jacaranda-800) / <alpha-value>)",
          900: "hsl(var(--v7-jacaranda-900) / <alpha-value>)",
        },
        success: "hsl(var(--v7-success) / <alpha-value>)",
        warning: "hsl(var(--v7-warning) / <alpha-value>)",
        danger: "hsl(var(--v7-danger) / <alpha-value>)",
        info: "hsl(var(--v7-info) / <alpha-value>)",
        driver: {
          vinny: "hsl(var(--v7-driver-vinny) / <alpha-value>)",
          ashley: "hsl(var(--v7-driver-ashley) / <alpha-value>)",
          refiloe: "hsl(var(--v7-driver-refiloe) / <alpha-value>)",
          clifford: "hsl(var(--v7-driver-clifford) / <alpha-value>)",
        },
      },
      backgroundImage: {
        "jacaranda-gradient": "linear-gradient(135deg, hsl(var(--v7-jacaranda-400)) 0%, hsl(288 56% 52%) 100%)",
      },
      boxShadow: {
        "v7-sm": "var(--v7-shadow-sm)",
        "v7-md": "var(--v7-shadow-md)",
        "v7-lg": "var(--v7-shadow-lg)",
      },
      fontFamily: {
        sans: ["Inter", "var(--font-sans)", "system-ui", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
        serif: ["var(--font-serif)"],
        mono: ["JetBrains Mono", "var(--font-mono)", "monospace"],
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
