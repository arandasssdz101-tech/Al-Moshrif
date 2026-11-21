import { Check, Monitor, Moon, Palette, Pipette, RotateCcw, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import {
  DEFAULT_THEME_PREFS,
  THEME_COLOR_PRESETS,
  type PresetColorId,
  type ThemeMode,
} from '@/utils/theme';

const MODE_OPTIONS: { id: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { id: 'light', icon: Sun, labelKey: 'settings.appearance.modes.light' },
  { id: 'dark', icon: Moon, labelKey: 'settings.appearance.modes.dark' },
  { id: 'system', icon: Monitor, labelKey: 'settings.appearance.modes.system' },
];

const SWATCH_BG_CLASS: Record<PresetColorId, string> = {
  teal: 'bg-[#0d9488]',
  blue: 'bg-[#2563eb]',
  sky: 'bg-[#0284c7]',
  cyan: 'bg-[#0891b2]',
  indigo: 'bg-[#4f46e5]',
  violet: 'bg-[#7c3aed]',
  purple: 'bg-[#9333ea]',
  fuchsia: 'bg-[#c026d3]',
  pink: 'bg-[#db2777]',
  rose: 'bg-[#e11d48]',
  red: 'bg-[#dc2626]',
  orange: 'bg-[#ea580c]',
  amber: 'bg-[#d97706]',
  yellow: 'bg-[#ca8a04]',
  lime: 'bg-[#65a30d]',
  green: 'bg-[#16a34a]',
  emerald: 'bg-[#059669]',
  slate: 'bg-[#475569]',
};

export function AppearanceSection() {
  const { t } = useTranslation();
  const { prefs, setMode, setColor, setCustomHex, resetDefaults } = useTheme();

  const isDefault =
    prefs.mode === DEFAULT_THEME_PREFS.mode &&
    prefs.color === DEFAULT_THEME_PREFS.color;

  const activeColorLabel =
    prefs.color === 'custom'
      ? `${t('settings.appearance.customColor')} (${prefs.customHex.toUpperCase()})`
      : t(`settings.appearance.colors.${prefs.color}`);

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <Palette className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-bold text-neutral-900">{t('settings.appearance.title')}</h2>
            <p className="text-sm text-neutral-600">{t('settings.appearance.subtitle')}</p>
          </div>
        </div>
        {!isDefault ? (
          <button
            type="button"
            onClick={resetDefaults}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            <span>{t('settings.appearance.reset')}</span>
          </button>
        ) : null}
      </div>

      {/* Light / Dark / System Mode Selector */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-neutral-800">{t('settings.appearance.modeLabel')}</span>
        <div
          role="radiogroup"
          aria-label={t('settings.appearance.modeLabel')}
          className="grid grid-cols-3 gap-1.5 rounded-xl bg-neutral-100 p-1"
        >
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = prefs.mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(option.id)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-neutral-200'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t(option.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* All Available Color Themes Grid */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-neutral-800">{t('settings.appearance.colorLabel')}</span>
          <span className="text-xs font-semibold text-primary-700">{activeColorLabel}</span>
        </div>

        <div
          role="radiogroup"
          aria-label={t('settings.appearance.colorLabel')}
          className="grid grid-cols-6 gap-2.5 sm:grid-cols-9"
        >
          {THEME_COLOR_PRESETS.map((preset) => {
            const active = prefs.color === preset.id;
            const colorName = t(`settings.appearance.colors.${preset.id}`);
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={colorName}
                title={colorName}
                onClick={() => setColor(preset.id)}
                className={`group flex flex-col items-center gap-1 rounded-xl p-1.5 transition ${
                  active
                    ? 'bg-primary-50 ring-2 ring-primary-500'
                    : 'hover:bg-neutral-100'
                }`}
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-full shadow-sm ring-1 ring-black/10 transition-transform group-hover:scale-105 ${SWATCH_BG_CLASS[preset.id]}`}
                >
                  {active ? <Check className="size-4 stroke-[3] text-white" aria-hidden /> : null}
                </span>
                <span className="w-full truncate text-center text-[10px] font-medium text-neutral-600">
                  {colorName}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Full-Spectrum Color Picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4">
        <div className="flex items-center gap-2.5">
          <Pipette className="size-4 shrink-0 text-neutral-500" aria-hidden />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-neutral-800">{t('settings.appearance.customColor')}</span>
            <span className="text-xs text-neutral-500">{t('settings.appearance.customColorHint')}</span>
          </div>
        </div>

        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-1.5 transition hover:border-primary-400">
          <input
            type="color"
            value={prefs.customHex}
            onChange={(event) => setCustomHex(event.target.value)}
            aria-label={t('settings.appearance.customColor')}
            className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <span className="font-mono text-xs font-semibold uppercase tabular-nums text-neutral-800" dir="ltr">
            {prefs.customHex}
          </span>
        </label>
      </div>
    </section>
  );
}
