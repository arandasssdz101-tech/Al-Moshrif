/**
 * Runtime polyfills for older Android System WebViews (Android 7–11 / Chrome 64+)
 * so modern APIs used by the app and third-party libraries (Dexie, PDF.js, Recharts, etc.)
 * never throw on older devices.
 */

function randomHexBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function fallbackRandomUUID(): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = randomHexBytes(16);
  // RFC 4122 version 4 UUID bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function installCompatPolyfills(): void {
  // 1. globalThis (Chrome < 71)
  if (typeof globalThis === 'undefined' && typeof window !== 'undefined') {
    (window as unknown as { globalThis: Window }).globalThis = window;
  }

  // 2. crypto.randomUUID (Chrome < 92 or non-secure context)
  if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues<T extends ArrayBufferView>(arr: T): T {
          const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          for (let i = 0; i < view.length; i += 1) {
            view[i] = Math.floor(Math.random() * 256);
          }
          return arr;
        },
        randomUUID: fallbackRandomUUID,
      },
      configurable: true,
    });
  } else if (typeof globalThis.crypto.randomUUID !== 'function') {
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: fallbackRandomUUID,
        configurable: true,
        writable: true,
      });
    } catch {
      // Some frozen Crypto prototypes disallow defining directly
    }
  }

  // 3. Object.hasOwn (Chrome < 93)
  const ObjectWithHasOwn = Object as ObjectConstructor & {
    hasOwn?: (obj: object, prop: PropertyKey) => boolean;
  };
  if (typeof ObjectWithHasOwn.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      value(obj: object, prop: PropertyKey): boolean {
        if (obj === null || obj === undefined) {
          throw new TypeError('Cannot convert undefined or null to object');
        }
        return Object.prototype.hasOwnProperty.call(Object(obj), prop);
      },
      configurable: true,
      writable: true,
    });
  }

  // 4. String.prototype.replaceAll (Chrome < 85)
  const stringProto = String.prototype as string & {
    replaceAll?: (search: string | RegExp, replacement: string | ((...args: unknown[]) => string)) => string;
  };
  if (typeof stringProto.replaceAll !== 'function') {
    Object.defineProperty(String.prototype, 'replaceAll', {
      value(this: string, search: string | RegExp, replacement: string | ((...args: unknown[]) => string)): string {
        const str = String(this);
        if (search instanceof RegExp) {
          if (!search.global) {
            throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
          }
          return str.replace(search, replacement as string);
        }
        const needle = String(search);
        if (needle === '') {
          const rep = typeof replacement === 'function' ? replacement('', 0, str) : String(replacement);
          return rep + str.split('').join(rep) + rep;
        }
        if (typeof replacement === 'function') {
          let result = '';
          let index = 0;
          let match = str.indexOf(needle, index);
          while (match !== -1) {
            result += str.slice(index, match) + String(replacement(needle, match, str));
            index = match + needle.length;
            match = str.indexOf(needle, index);
          }
          return result + str.slice(index);
        }
        return str.split(needle).join(String(replacement));
      },
      configurable: true,
      writable: true,
    });
  }

  // 5. Array.prototype.at (Chrome < 92)
  const arrayProto = Array.prototype as unknown[] & {
    at?: <T>(this: T[], index: number) => T | undefined;
    findLast?: <T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: unknown) => T | undefined;
    findLastIndex?: <T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: unknown) => number;
    toSorted?: <T>(this: T[], compareFn?: (a: T, b: T) => number) => T[];
    toReversed?: <T>(this: T[]) => T[];
  };
  if (typeof arrayProto.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      value<T>(this: T[], index: number): T | undefined {
        const len = this.length >>> 0;
        const n = Math.trunc(index) || 0;
        const k = n >= 0 ? n : len + n;
        if (k < 0 || k >= len) return undefined;
        return this[k];
      },
      configurable: true,
      writable: true,
    });
  }

  // 6. Array.prototype.findLast / findLastIndex (Chrome < 97)
  if (typeof arrayProto.findLast !== 'function') {
    Object.defineProperty(Array.prototype, 'findLast', {
      value<T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: unknown): T | undefined {
        for (let i = this.length - 1; i >= 0; i -= 1) {
          if (predicate.call(thisArg, this[i], i, this)) return this[i];
        }
        return undefined;
      },
      configurable: true,
      writable: true,
    });
  }

  if (typeof arrayProto.findLastIndex !== 'function') {
    Object.defineProperty(Array.prototype, 'findLastIndex', {
      value<T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: unknown): number {
        for (let i = this.length - 1; i >= 0; i -= 1) {
          if (predicate.call(thisArg, this[i], i, this)) return i;
        }
        return -1;
      },
      configurable: true,
      writable: true,
    });
  }

  // 7. Array.prototype.toSorted / toReversed (Chrome < 110)
  if (typeof arrayProto.toSorted !== 'function') {
    Object.defineProperty(Array.prototype, 'toSorted', {
      value<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
        return Array.from(this).sort(compareFn);
      },
      configurable: true,
      writable: true,
    });
  }

  if (typeof arrayProto.toReversed !== 'function') {
    Object.defineProperty(Array.prototype, 'toReversed', {
      value<T>(this: T[]): T[] {
        return Array.from(this).reverse();
      },
      configurable: true,
      writable: true,
    });
  }

  // 8. Promise.allSettled (Chrome < 76)
  if (typeof Promise.allSettled !== 'function') {
    Promise.allSettled = function allSettled<T>(
      promises: Iterable<T | PromiseLike<T>>,
    ): Promise<PromiseSettledResult<Awaited<T>>[]> {
      return Promise.all(
        Array.from(promises, (item) =>
          Promise.resolve(item).then(
            (value): PromiseFulfilledResult<Awaited<T>> => ({ status: 'fulfilled', value: value as Awaited<T> }),
            (reason): PromiseRejectedResult => ({ status: 'rejected', reason }),
          ),
        ),
      );
    };
  }

  // 9. Promise.withResolvers (Chrome < 119)
  const PromiseWithResolvers = Promise as typeof Promise & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof PromiseWithResolvers.withResolvers !== 'function') {
    PromiseWithResolvers.withResolvers = function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  // 10. URL.parse (Chrome < 126)
  const URLWithParse = URL as typeof URL & {
    parse?: (url: string | URL, base?: string | URL) => URL | null;
  };
  if (typeof URLWithParse.parse !== 'function') {
    URLWithParse.parse = function parseUrl(url: string | URL, base?: string | URL): URL | null {
      try {
        return base !== undefined ? new URL(url, base) : new URL(url);
      } catch {
        return null;
      }
    };
  }

  // 11. Map.prototype.getOrInsertComputed (Chrome < 134, used by pdfjs-dist v6)
  const mapProto = Map.prototype as Map<unknown, unknown> & {
    getOrInsertComputed?: <K, V>(this: Map<K, V>, key: K, callbackFn: (key: K) => V) => V;
  };
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value<K, V>(this: Map<K, V>, key: K, callbackFn: (key: K) => V): V {
        if (this.has(key)) {
          return this.get(key) as V;
        }
        const value = callbackFn(key);
        this.set(key, value);
        return value;
      },
      configurable: true,
      writable: true,
    });
  }

  // 12. structuredClone (Chrome < 98)
  if (typeof globalThis.structuredClone !== 'function') {
    const cloneValue = <T>(value: T): T => {
      if (value === null || typeof value !== 'object') return value;
      if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
      if (value instanceof RegExp) return new RegExp(value.source, value.flags) as unknown as T;
      if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T;
      if (value instanceof Uint8Array) return new Uint8Array(value) as unknown as T;
      if (value instanceof ArrayBuffer) return value.slice(0) as unknown as T;
      if (value instanceof Map) {
        const out = new Map();
        value.forEach((v, k) => out.set(cloneValue(k), cloneValue(v)));
        return out as unknown as T;
      }
      if (value instanceof Set) {
        const out = new Set();
        value.forEach((v) => out.add(cloneValue(v)));
        return out as unknown as T;
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>)) {
        out[key] = cloneValue((value as Record<string, unknown>)[key]);
      }
      return out as T;
    };

    Object.defineProperty(globalThis, 'structuredClone', {
      value: cloneValue,
      configurable: true,
      writable: true,
    });
  }

  // 13. Object.fromEntries (Chrome < 73)
  if (typeof Object.fromEntries !== 'function') {
    Object.defineProperty(Object, 'fromEntries', {
      value<T = unknown>(entries: Iterable<readonly [PropertyKey, T]>): Record<string, T> {
        const result: Record<PropertyKey, T> = {};
        for (const [key, val] of entries) {
          result[key] = val;
        }
        return result as Record<string, T>;
      },
      configurable: true,
      writable: true,
    });
  }

  // 14. Array.prototype.flat & flatMap (Chrome < 69)
  if (typeof Array.prototype.flat !== 'function') {
    Object.defineProperty(Array.prototype, 'flat', {
      value(this: unknown[], depth = 1): unknown[] {
        const maxDepth = Number.isNaN(Number(depth)) ? 0 : Math.floor(Number(depth));
        const flatten = (arr: unknown[], d: number): unknown[] => {
          const out: unknown[] = [];
          for (let i = 0; i < arr.length; i += 1) {
            if (!(i in arr)) continue;
            const item = arr[i];
            if (Array.isArray(item) && d > 0) {
              out.push(...flatten(item, d - 1));
            } else {
              out.push(item);
            }
          }
          return out;
        };
        return flatten(this, maxDepth);
      },
      configurable: true,
      writable: true,
    });
  }

  if (typeof Array.prototype.flatMap !== 'function') {
    Object.defineProperty(Array.prototype, 'flatMap', {
      value<T, U>(
        this: T[],
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        const out: U[] = [];
        for (let i = 0; i < this.length; i += 1) {
          if (!(i in this)) continue;
          const mapped = callback.call(thisArg, this[i], i, this);
          if (Array.isArray(mapped)) {
            out.push(...(mapped as U[]));
          } else {
            out.push(mapped as U);
          }
        }
        return out;
      },
      configurable: true,
      writable: true,
    });
  }

  // 15. String.prototype.trimStart & trimEnd (Chrome < 66)
  if (typeof String.prototype.trimStart !== 'function') {
    Object.defineProperty(String.prototype, 'trimStart', {
      value(this: string): string {
        return String(this).replace(/^\s+/, '');
      },
      configurable: true,
      writable: true,
    });
  }

  if (typeof String.prototype.trimEnd !== 'function') {
    Object.defineProperty(String.prototype, 'trimEnd', {
      value(this: string): string {
        return String(this).replace(/\s+$/, '');
      },
      configurable: true,
      writable: true,
    });
  }

  // 16. queueMicrotask (Chrome < 71)
  if (typeof globalThis.queueMicrotask !== 'function') {
    Object.defineProperty(globalThis, 'queueMicrotask', {
      value(callback: VoidFunction): void {
        Promise.resolve()
          .then(callback)
          .catch((err) => {
            setTimeout(() => {
              throw err;
            }, 0);
          });
      },
      configurable: true,
      writable: true,
    });
  }
}

installCompatPolyfills();
