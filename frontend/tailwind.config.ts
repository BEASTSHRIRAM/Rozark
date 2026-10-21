import type { Config } from "tailwindcss";

// Rozark design system — "ink on paper" (original palette, Oct 2026).
// Warm paper light theme, editorial and typography-led. Vermillion leads;
// cobalt is a whisper (links, small data accents). No gradients-as-
// decoration, no glow halos, no rainbow anything.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAF6EF", // page background
        parchment: "#F1E9D8", // deeper paper for bands / strips
        card: "#FFFDF7", // card surface on paper
        ink: "#1B1712", // primary text / dark panels
        inkdeep: "#14100C", // app interior background (warm black)
        inkpanel: "#221C15", // raised panel on ink
        vermillion: "#E8490F", // THE accent — buttons, key highlights
        vermilliondeep: "#C53D0B", // accent hover / pressed
        cobalt: "#2B3FE0", // secondary — links, small chart accents
        cobaltlt: "#8EA2FF", // cobalt tint, readable on ink surfaces
        sage: "#4C8055", // functional success, product UI only
        sagelt: "#8FC79B", // sage tint on ink surfaces
        sand: "#E3DAC6", // warm hairline borders on paper
        sanddeep: "#CBBd9d",
        stonewarm: "#8A7F6A", // muted warm grey — secondary text, debug phase
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
