import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { isDark, toggleDarkMode } = useTheme();
  const label = isDark ? t('settings.appearance.switchToLight') : t('settings.appearance.switchToDark');

  return (
    <button
      type="button"
      onClick={toggleDarkMode}
      aria-label={label}
      title={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 transition hover:bg-neutral-100"
    >
      {isDark ? <Sun className="size-4 text-accent-400" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
