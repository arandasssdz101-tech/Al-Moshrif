import { describe, expect, it, vi } from 'vitest';
import { fallbackRandomUUID, installCompatPolyfills } from './polyfills';
import { safeScrollIntoView } from './utils/scroll';

describe('Android WebView compatibility polyfills', () => {
  it('generates valid RFC 4122 v4 UUIDs with fallbackRandomUUID', () => {
    const uuid = fallbackRandomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const second = fallbackRandomUUID();
    expect(second).not.toBe(uuid);
  });

  it('installs polyfills idempotently without throwing', () => {
    expect(() => installCompatPolyfills()).not.toThrow();
    expect(typeof crypto.randomUUID).toBe('function');
    expect(typeof Reflect.get(Object, 'hasOwn')).toBe('function');
    expect(typeof Object.fromEntries).toBe('function');
    expect(typeof Object.values).toBe('function');
    expect(typeof Object.entries).toBe('function');
    expect(typeof Reflect.get(Array.prototype, 'at')).toBe('function');
    expect(typeof Array.prototype.includes).toBe('function');
    expect(typeof Array.prototype.flat).toBe('function');
    expect(typeof Array.prototype.flatMap).toBe('function');
    expect(typeof Reflect.get(String.prototype, 'replaceAll')).toBe('function');
    expect(typeof String.prototype.padStart).toBe('function');
    expect(typeof String.prototype.padEnd).toBe('function');
    expect(typeof String.prototype.trimStart).toBe('function');
    expect(typeof String.prototype.trimEnd).toBe('function');
    expect(typeof Promise.allSettled).toBe('function');
    expect(typeof Promise.prototype.finally).toBe('function');
    expect(typeof globalThis.AbortController).toBe('function');
    expect(typeof globalThis.structuredClone).toBe('function');
    expect(typeof globalThis.queueMicrotask).toBe('function');
  });

  it('safeScrollIntoView falls back to boolean signature when dictionary options throw', () => {
    const scrollIntoView = vi.fn((arg?: boolean | ScrollIntoViewOptions) => {
      if (typeof arg === 'object') {
        throw new TypeError('Invalid options object');
      }
    });
    const fakeEl = { scrollIntoView } as unknown as Element;
    safeScrollIntoView(fakeEl, { inline: 'center', block: 'nearest', behavior: 'smooth' });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith(true);
  });
});
