import { createTheme } from '@mantine/core';

/**
 * EssayCoach Design System — Warm Editorial
 *
 * Aesthetic: Hemingway-inspired, warm, literary. The essay is the hero.
 * Fonts: Instrument Serif (display), Source Sans 3 (body), DM Sans (UI)
 * Colors: Blue primary (trust/education), amber accent (celebration), warm grays
 *
 * To change the theme, modify values here. All components inherit from this.
 */
export const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: '"DM Sans", system-ui, sans-serif',
  headings: {
    fontFamily: '"Instrument Serif", Georgia, serif',
    fontWeight: '400',
  },
  colors: {
    // Override Mantine's blue with our primary
    blue: [
      '#EFF6FF', '#DBEAFE', '#BFDBFE', '#93C5FD',
      '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8',
      '#1E40AF', '#1E3A8A',
    ],
  },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
});
