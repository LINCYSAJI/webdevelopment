/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand colours come from Admin settings at runtime (see src/branding).
        brand: 'rgb(var(--brand-primary) / <alpha-value>)',
        accent: 'rgb(var(--brand-secondary) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
