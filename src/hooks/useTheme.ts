import { useEffect, useState } from 'react';
import {
  DEFAULT_THEME_PREFS,
  getThemePreferences,
  resolveIsDark,
  subscribeThemePreferences,
  updateThemePreferences,
  type ThemeColorId,
  type ThemeMode,
  type ThemePreferences,
} from '@/utils/theme';

export function useTheme() {
  const [prefs, setPrefs] = useState<ThemePreferences>(() => getThemePreferences());
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(getThemePreferences().mode));

  useEffect(() => {
    const sync = (next: ThemePreferences) => {
      setPrefs(next);
      setIsDark(resolveIsDark(next.mode));
    };
    const unsubscribe = subscribeThemePreferences(sync);

    const mql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const handleMedia = () => {
      setIsDark(resolveIsDark(getThemePreferences().mode));
    };
    if (mql && typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleMedia);
    }

    return () => {
      unsubscribe();
      if (mql && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleMedia);
      }
    };
  }, []);

  return {
    prefs,
    isDark,
    setMode: (mode: ThemeMode) => updateThemePreferences({ mode }),
    setColor: (color: ThemeColorId) => updateThemePreferences({ color }),
    setCustomHex: (customHex: string) => updateThemePreferences({ color: 'custom', customHex }),
    toggleDarkMode: () => updateThemePreferences({ mode: isDark ? 'light' : 'dark' }),
    resetDefaults: () => updateThemePreferences(DEFAULT_THEME_PREFS),
  };
}
