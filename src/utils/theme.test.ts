import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PREFS,
  THEME_COLOR_PRESETS,
  buildScaleFromHex,
  normalizeHex,
  resolvePrimaryScale,
} from '@/utils/theme';

describe('theme utilities', () => {
  it('provides all 18 Tailwind color presets with complete 50-950 RGB scales', () => {
    expect(THEME_COLOR_PRESETS.length).toBe(18);
    const ids = THEME_COLOR_PRESETS.map((p) => p.id);
    expect(ids).toContain('teal');
    expect(ids).toContain('blue');
    expect(ids).toContain('indigo');
    expect(ids).toContain('violet');
    expect(ids).toContain('rose');
    expect(ids).toContain('red');
    expect(ids).toContain('orange');
    expect(ids).toContain('amber');
    expect(ids).toContain('yellow');
    expect(ids).toContain('lime');
    expect(ids).toContain('green');
    expect(ids).toContain('emerald');
    expect(ids).toContain('slate');

    for (const preset of THEME_COLOR_PRESETS) {
      expect(Object.keys(preset.scale)).toHaveLength(11);
      for (const value of Object.values(preset.scale)) {
        expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
    }
  });

  it('normalizes short and full hex values and generates valid RGB triplets for custom colors', () => {
    expect(normalizeHex('#0F8')).toBe('#00ff88');
    expect(normalizeHex('1E6FD9')).toBe('#1e6fd9');
    expect(normalizeHex('invalid')).toBe(DEFAULT_THEME_PREFS.customHex);

    const scale = buildScaleFromHex('#1e6fd9');
    expect(Object.keys(scale)).toHaveLength(11);
    for (const value of Object.values(scale)) {
      expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });

  it('adapts dark-mode accent tint and text contrast shades cleanly', () => {
    const light = resolvePrimaryScale({ mode: 'light', color: 'blue', customHex: '#1e6fd9' }, false);
    const dark = resolvePrimaryScale({ mode: 'dark', color: 'blue', customHex: '#1e6fd9' }, true);

    // Light 50 is very pale (>230), while dark 50 is dark-tinted (<100)
    const light50Sum = light['50'].split(' ').map(Number).reduce((a, b) => a + b, 0);
    const dark50Sum = dark['50'].split(' ').map(Number).reduce((a, b) => a + b, 0);
    expect(light50Sum).toBeGreaterThan(680);
    expect(dark50Sum).toBeLessThan(260);

    // Dark 700 lifts to bright shade 300 for legible accent text on dark cards
    expect(dark['700']).toBe(light['300']);
  });
});
