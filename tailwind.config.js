function cssVarScale(name) {
  return {
    50: `rgb(var(--color-${name}-50) / <alpha-value>)`,
    100: `rgb(var(--color-${name}-100) / <alpha-value>)`,
    200: `rgb(var(--color-${name}-200) / <alpha-value>)`,
    300: `rgb(var(--color-${name}-300) / <alpha-value>)`,
    400: `rgb(var(--color-${name}-400) / <alpha-value>)`,
    500: `rgb(var(--color-${name}-500) / <alpha-value>)`,
    600: `rgb(var(--color-${name}-600) / <alpha-value>)`,
    700: `rgb(var(--color-${name}-700) / <alpha-value>)`,
    800: `rgb(var(--color-${name}-800) / <alpha-value>)`,
    900: `rgb(var(--color-${name}-900) / <alpha-value>)`,
    950: `rgb(var(--color-${name}-950) / <alpha-value>)`,
  };
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['variant', ['.dark &', '&.dark']],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: cssVarScale('primary'),
        secondary: cssVarScale('secondary'),
        accent: cssVarScale('accent'),
        success: cssVarScale('success'),
        warning: cssVarScale('warning'),
        danger: cssVarScale('danger'),
        neutral: cssVarScale('neutral'),
      },
      backgroundColor: {
        white: 'rgb(var(--color-surface) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
