import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      keyframes: {
        // Nebula drift. Deliberately tiny: a few percent of travel and a 6%
        // scale over ~18s, which reads as depth shifting rather than motion.
        // Transform + opacity only, so it stays off the layout/paint path.
        "nebula-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)", opacity: "0.85" },
          "50%": { transform: "translate3d(2.5%, -1.5%, 0) scale(1.06)", opacity: "1" },
        },
        twinkle: {
          "0%, 100%": { opacity: "0.12" },
          "50%": { opacity: "0.9" },
        },
      },
      animation: {
        "nebula-drift": "nebula-drift 18s ease-in-out infinite",
        twinkle: "twinkle 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
