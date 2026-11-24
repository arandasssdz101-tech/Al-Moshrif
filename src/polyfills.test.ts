import { describe, expect, it } from 'vitest';
import { fallbackRandomUUID, installCompatPolyfills } from './polyfills';

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
    expect(typeof Reflect.get(Array.prototype, 'at')).toBe('function');
    expect(typeof Array.prototype.flat).toBe('function');
    expect(typeof Array.prototype.flatMap).toBe('function');
    expect(typeof Reflect.get(String.prototype, 'replaceAll')).toBe('function');
    expect(typeof String.prototype.trimStart).toBe('function');
    expect(typeof String.prototype.trimEnd).toBe('function');
    expect(typeof Promise.allSettled).toBe('function');
    expect(typeof globalThis.structuredClone).toBe('function');
    expect(typeof globalThis.queueMicrotask).toBe('function');
  });
});
