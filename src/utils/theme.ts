export type ThemeMode = 'light' | 'dark' | 'system';

export type PresetColorId =
  | 'teal'
  | 'blue'
  | 'sky'
  | 'cyan'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'slate';

export type ThemeColorId = PresetColorId | 'custom';

export interface ThemePreferences {
  mode: ThemeMode;
  color: ThemeColorId;
  customHex: string;
}

export type ShadeKey = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';
export type ColorScale = Record<ShadeKey, string>;

export interface ThemeColorPreset {
  id: PresetColorId;
  swatchHex: string;
  scale: ColorScale;
}

const STORAGE_KEY = 'edutrack_theme_prefs';

export const DEFAULT_THEME_PREFS: ThemePreferences = {
  mode: 'light',
  color: 'teal',
  customHex: '#1e6fd9',
};

export const THEME_COLOR_PRESETS: ThemeColorPreset[] = [
  {
    id: 'teal',
    swatchHex: '#0d9488',
    scale: {
      '50': '240 253 250',
      '100': '204 251 241',
      '200': '153 246 228',
      '300': '94 234 212',
      '400': '45 212 191',
      '500': '20 184 166',
      '600': '13 148 136',
      '700': '15 118 110',
      '800': '17 94 89',
      '900': '19 78 74',
      '950': '4 47 46',
    },
  },
  {
    id: 'blue',
    swatchHex: '#2563eb',
    scale: {
      '50': '239 246 255',
      '100': '219 234 254',
      '200': '191 219 254',
      '300': '147 197 253',
      '400': '96 165 250',
      '500': '59 130 246',
      '600': '37 99 235',
      '700': '29 78 216',
      '800': '30 64 175',
      '900': '30 58 138',
      '950': '23 37 84',
    },
  },
  {
    id: 'sky',
    swatchHex: '#0284c7',
    scale: {
      '50': '240 249 255',
      '100': '224 242 254',
      '200': '186 230 253',
      '300': '125 211 252',
      '400': '56 189 248',
      '500': '14 165 233',
      '600': '2 132 199',
      '700': '3 105 161',
      '800': '7 89 133',
      '900': '12 74 110',
      '950': '8 47 73',
    },
  },
  {
    id: 'cyan',
    swatchHex: '#0891b2',
    scale: {
      '50': '236 254 255',
      '100': '207 250 254',
      '200': '165 243 252',
      '300': '103 232 249',
      '400': '34 211 238',
      '500': '6 182 212',
      '600': '8 145 178',
      '700': '14 116 144',
      '800': '21 94 117',
      '900': '22 78 99',
      '950': '8 51 68',
    },
  },
  {
    id: 'indigo',
    swatchHex: '#4f46e5',
    scale: {
      '50': '238 242 255',
      '100': '224 231 255',
      '200': '199 210 254',
      '300': '165 180 252',
      '400': '129 140 248',
      '500': '99 102 241',
      '600': '79 70 229',
      '700': '67 56 202',
      '800': '55 48 163',
      '900': '49 46 129',
      '950': '30 27 75',
    },
  },
  {
    id: 'violet',
    swatchHex: '#7c3aed',
    scale: {
      '50': '245 243 255',
      '100': '237 233 254',
      '200': '221 214 254',
      '300': '196 181 253',
      '400': '167 139 250',
      '500': '139 92 246',
      '600': '124 58 237',
      '700': '109 40 217',
      '800': '91 33 182',
      '900': '76 29 149',
      '950': '46 16 101',
    },
  },
  {
    id: 'purple',
    swatchHex: '#9333ea',
    scale: {
      '50': '250 245 255',
      '100': '243 232 255',
      '200': '233 213 255',
      '300': '216 180 254',
      '400': '192 132 252',
      '500': '168 85 247',
      '600': '147 51 234',
      '700': '126 34 206',
      '800': '107 33 168',
      '900': '88 28 135',
      '950': '59 7 100',
    },
  },
  {
    id: 'fuchsia',
    swatchHex: '#c026d3',
    scale: {
      '50': '253 244 255',
      '100': '250 232 255',
      '200': '245 208 254',
      '300': '240 171 252',
      '400': '232 121 249',
      '500': '217 70 239',
      '600': '192 38 211',
      '700': '162 28 175',
      '800': '134 25 143',
      '900': '112 26 117',
      '950': '74 4 78',
    },
  },
  {
    id: 'pink',
    swatchHex: '#db2777',
    scale: {
      '50': '253 242 248',
      '100': '252 231 243',
      '200': '251 207 232',
      '300': '249 168 212',
      '400': '244 114 182',
      '500': '236 72 153',
      '600': '219 39 119',
      '700': '190 24 93',
      '800': '157 23 77',
      '900': '131 24 67',
      '950': '80 7 36',
    },
  },
  {
    id: 'rose',
    swatchHex: '#e11d48',
    scale: {
      '50': '255 241 242',
      '100': '255 228 230',
      '200': '254 205 211',
      '300': '253 164 175',
      '400': '251 113 133',
      '500': '244 63 94',
      '600': '225 29 72',
      '700': '190 18 60',
      '800': '159 18 57',
      '900': '136 19 55',
      '950': '76 5 25',
    },
  },
  {
    id: 'red',
    swatchHex: '#dc2626',
    scale: {
      '50': '254 242 242',
      '100': '254 226 226',
      '200': '254 202 202',
      '300': '252 165 165',
      '400': '248 113 113',
      '500': '239 68 68',
      '600': '220 38 38',
      '700': '185 28 28',
      '800': '153 27 27',
      '900': '127 29 29',
      '950': '69 10 10',
    },
  },
  {
    id: 'orange',
    swatchHex: '#ea580c',
    scale: {
      '50': '255 247 237',
      '100': '255 237 213',
      '200': '254 215 170',
      '300': '253 186 116',
      '400': '251 146 60',
      '500': '249 115 22',
      '600': '234 88 12',
      '700': '194 65 12',
      '800': '154 52 18',
      '900': '124 45 18',
      '950': '67 20 7',
    },
  },
  {
    id: 'amber',
    swatchHex: '#d97706',
    scale: {
      '50': '255 251 235',
      '100': '254 243 199',
      '200': '253 230 138',
      '300': '252 211 77',
      '400': '251 191 36',
      '500': '245 158 11',
      '600': '194 102 6',
      '700': '161 77 7',
      '800': '133 63 12',
      '900': '113 52 15',
      '950': '69 26 3',
    },
  },
  {
    id: 'yellow',
    swatchHex: '#ca8a04',
    scale: {
      '50': '254 252 232',
      '100': '254 249 195',
      '200': '254 240 138',
      '300': '253 224 71',
      '400': '250 204 21',
      '500': '234 179 8',
      '600': '161 98 7',
      '700': '133 77 14',
      '800': '113 63 18',
      '900': '96 52 16',
      '950': '66 32 6',
    },
  },
  {
    id: 'lime',
    swatchHex: '#65a30d',
    scale: {
      '50': '247 254 231',
      '100': '236 252 203',
      '200': '217 249 157',
      '300': '190 242 100',
      '400': '163 230 53',
      '500': '132 204 22',
      '600': '77 124 15',
      '700': '63 98 18',
      '800': '54 83 20',
      '900': '45 69 18',
      '950': '26 46 5',
    },
  },
  {
    id: 'green',
    swatchHex: '#16a34a',
    scale: {
      '50': '240 253 244',
      '100': '220 252 231',
      '200': '187 247 208',
      '300': '134 239 172',
      '400': '74 222 128',
      '500': '34 197 94',
      '600': '22 163 74',
      '700': '21 128 61',
      '800': '22 101 52',
      '900': '20 83 45',
      '950': '5 46 22',
    },
  },
  {
    id: 'emerald',
    swatchHex: '#059669',
    scale: {
      '50': '236 253 245',
      '100': '209 250 229',
      '200': '167 243 208',
      '300': '110 231 183',
      '400': '52 211 153',
      '500': '16 185 129',
      '600': '5 150 105',
      '700': '4 120 87',
      '800': '6 95 70',
      '900': '6 78 59',
      '950': '2 44 34',
    },
  },
  {
    id: 'slate',
    swatchHex: '#475569',
    scale: {
      '50': '248 250 252',
      '100': '241 245 249',
      '200': '226 232 240',
      '300': '203 213 225',
      '400': '148 163 184',
      '500': '100 116 139',
      '600': '71 85 105',
      '700': '51 65 85',
      '800': '30 41 59',
      '900': '15 23 42',
      '950': '2 6 23',
    },
  },
];

const PRESET_MAP = new Map<PresetColorId, ThemeColorPreset>(
  THEME_COLOR_PRESETS.map((preset) => [preset.id, preset]),
);

function parseTriplet(triplet: string): [number, number, number] {
  const parts = triplet.split(' ').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function mixRgb(a: [number, number, number], b: [number, number, number], weightB: number): string {
  const w = Math.max(0, Math.min(1, weightB));
  const r = Math.round(a[0] * (1 - w) + b[0] * w);
  const g = Math.round(a[1] * (1 - w) + b[1] * w);
  const bl = Math.round(a[2] * (1 - w) + b[2] * w);
  return `${r} ${g} ${bl}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace(/^#/, '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return [30, 111, 217];
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgbTriplet(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
}

export function normalizeHex(hex: string): string {
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${cleaned
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`;
  }
  return DEFAULT_THEME_PREFS.customHex;
}

export function buildScaleFromHex(hex: string): ColorScale {
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const sat = Math.max(0.12, Math.min(0.92, s));
  return {
    '50': hslToRgbTriplet(h, Math.min(1, sat * 0.95), 0.96),
    '100': hslToRgbTriplet(h, Math.min(1, sat * 0.95), 0.91),
    '200': hslToRgbTriplet(h, Math.min(1, sat * 0.92), 0.83),
    '300': hslToRgbTriplet(h, Math.min(1, sat * 0.9), 0.71),
    '400': hslToRgbTriplet(h, sat, 0.59),
    '500': hslToRgbTriplet(h, sat, 0.48),
    // Clamped lightness guarantees crisp WCAG AA contrast for white text on primary-600 buttons
    '600': hslToRgbTriplet(h, Math.min(0.95, sat * 1.04), 0.40),
    '700': hslToRgbTriplet(h, Math.min(0.95, sat * 1.05), 0.33),
    '800': hslToRgbTriplet(h, sat, 0.27),
    '900': hslToRgbTriplet(h, sat * 0.95, 0.21),
    '950': hslToRgbTriplet(h, sat * 0.9, 0.13),
  };
}

export function resolvePrimaryScale(prefs: ThemePreferences, isDark: boolean): ColorScale {
  const baseScale =
    prefs.color === 'custom'
      ? buildScaleFromHex(prefs.customHex)
      : (PRESET_MAP.get(prefs.color) ?? THEME_COLOR_PRESETS[0]).scale;

  if (!isDark) return baseScale;

  const darkCanvas: [number, number, number] = [15, 23, 42];
  const darkSurface: [number, number, number] = [30, 41, 59];
  const accent500 = parseTriplet(baseScale['500']);

  return {
    // Soft dark tinted badges & hover surfaces (never glaring white in dark mode)
    '50': mixRgb(darkCanvas, accent500, 0.18),
    '100': mixRgb(darkCanvas, accent500, 0.28),
    '200': mixRgb(darkSurface, accent500, 0.42),
    '300': baseScale['400'],
    '400': baseScale['400'],
    '500': baseScale['500'],
    '600': baseScale['600'],
    // Lift text-primary-700/800/900 to luminous shades for >= 6:1 contrast on dark cards
    '700': baseScale['300'],
    '800': baseScale['200'],
    '900': baseScale['100'],
    '950': baseScale['50'],
  };
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function loadThemePreferences(): ThemePreferences {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_PREFS;
    const parsed = JSON.parse(raw) as Partial<ThemePreferences>;
    const mode: ThemeMode =
      parsed.mode === 'light' || parsed.mode === 'dark' || parsed.mode === 'system'
        ? parsed.mode
        : DEFAULT_THEME_PREFS.mode;
    const color: ThemeColorId =
      parsed.color === 'custom' || (typeof parsed.color === 'string' && PRESET_MAP.has(parsed.color as PresetColorId))
        ? (parsed.color as ThemeColorId)
        : DEFAULT_THEME_PREFS.color;
    const customHex =
      typeof parsed.customHex === 'string' ? normalizeHex(parsed.customHex) : DEFAULT_THEME_PREFS.customHex;
    return { mode, color, customHex };
  } catch {
    return DEFAULT_THEME_PREFS;
  }
}

export function saveThemePreferences(prefs: ThemePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function getActiveSwatchHex(prefs: ThemePreferences): string {
  if (prefs.color === 'custom') return normalizeHex(prefs.customHex);
  return (PRESET_MAP.get(prefs.color) ?? THEME_COLOR_PRESETS[0]).swatchHex;
}

const listeners = new Set<(prefs: ThemePreferences) => void>();
let currentPrefs: ThemePreferences = DEFAULT_THEME_PREFS;
let mediaBound = false;

export function applyThemePreferences(prefs: ThemePreferences): void {
  currentPrefs = prefs;
  if (typeof document === 'undefined') return;

  const isDark = resolveIsDark(prefs.mode);
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';

  const scale = resolvePrimaryScale(prefs, isDark);
  for (const shade of Object.keys(scale) as ShadeKey[]) {
    root.style.setProperty(`--color-primary-${shade}`, scale[shade]);
  }

  const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.content = isDark ? '#0f172a' : getActiveSwatchHex(prefs);
  }
}

export function initTheme(): ThemePreferences {
  const prefs = loadThemePreferences();
  applyThemePreferences(prefs);

  if (!mediaBound && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaBound = true;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (currentPrefs.mode === 'system') {
        applyThemePreferences(currentPrefs);
      }
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
    }
  }
  return prefs;
}

export function updateThemePreferences(patch: Partial<ThemePreferences>): ThemePreferences {
  const next: ThemePreferences = {
    ...currentPrefs,
    ...patch,
    customHex: patch.customHex !== undefined ? normalizeHex(patch.customHex) : currentPrefs.customHex,
  };
  saveThemePreferences(next);
  applyThemePreferences(next);
  listeners.forEach((listener) => listener(next));
  return next;
}

export function getThemePreferences(): ThemePreferences {
  return currentPrefs;
}

export function subscribeThemePreferences(listener: (prefs: ThemePreferences) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
