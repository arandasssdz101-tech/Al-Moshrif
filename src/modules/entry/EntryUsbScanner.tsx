import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeScannedCode } from '@/utils/studentQr';

interface EntryUsbScannerProps {
  enabled: boolean;
  azertyFix: boolean;
  cooldownSeconds: number;
  disabled?: boolean;
  onToggleEnabled: () => void;
  onToggleAzertyFix: () => void;
  onDetect: (normalizedCode: string) => void;
}

const BURST_IDLE_MS = 80;
const FAST_KEY_INTERVAL_MS = 65;

function isInteractiveInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-entry-keep-focus="true"]')) return true;
  if (target.closest('[role="dialog"]')) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
    return target.getAttribute('data-entry-usb-input') !== 'true';
  }
  return false;
}

export function EntryUsbScanner({
  enabled,
  azertyFix,
  cooldownSeconds,
  disabled = false,
  onToggleEnabled,
  onToggleAzertyFix,
  onDetect,
}: EntryUsbScannerProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bufferRef = useRef('');
  const lastCharAtRef = useRef(0);
  const fastBurstRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const onDetectRef = useRef(onDetect);
  const azertyRef = useRef(azertyFix);
  const cooldownMsRef = useRef(cooldownSeconds * 1000);
  const seenRef = useRef<Map<string, number>>(new Map());
  const focusTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    azertyRef.current = azertyFix;
  }, [azertyFix]);

  useEffect(() => {
    cooldownMsRef.current = Math.max(0, cooldownSeconds) * 1000;
  }, [cooldownSeconds]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearFocusTimers = useCallback(() => {
    for (const timer of focusTimersRef.current) {
      window.clearTimeout(timer);
    }
    focusTimersRef.current.clear();
  }, []);

  const focusScanner = useCallback(() => {
    if (!enabled || disabled) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    setFocused(document.activeElement === input);
  }, [enabled, disabled]);

  const scheduleFocus = useCallback(
    (delayMs: number) => {
      const timer = window.setTimeout(() => {
        focusTimersRef.current.delete(timer);
        if (!isInteractiveInput(document.activeElement)) {
          focusScanner();
        }
      }, delayMs);
      focusTimersRef.current.add(timer);
    },
    [focusScanner],
  );

  const flushBuffer = useCallback(() => {
    clearIdleTimer();
    const raw = bufferRef.current;
    bufferRef.current = '';
    fastBurstRef.current = false;
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    const normalized = normalizeScannedCode(raw, { convertAzertyDigits: azertyRef.current });
    if (!normalized) return;

    const now = Date.now();
    if (seenRef.current.size > 200) {
      const maxAge = Math.max(cooldownMsRef.current, 10_000);
      for (const [key, ts] of seenRef.current.entries()) {
        if (now - ts > maxAge) {
          seenRef.current.delete(key);
        }
      }
    }
    const last = seenRef.current.get(normalized);
    if (last !== undefined && now - last < cooldownMsRef.current) {
      return;
    }
    seenRef.current.set(normalized, now);
    onDetectRef.current(normalized);
  }, [clearIdleTimer]);

  // Autofocus when enabled, refocus on window focus and on screen clicks outside form controls/dialogs
  useEffect(() => {
    if (!enabled || disabled) {
      setFocused(false);
      clearIdleTimer();
      clearFocusTimers();
      return;
    }

    const focusSoon = () => scheduleFocus(20);

    focusSoon();

    const handleWindowFocus = () => focusSoon();
    const handlePointerDown = (event: PointerEvent) => {
      if (isInteractiveInput(event.target)) return;
      // Don't hijack button clicks before they fire; refocus right after
      scheduleFocus(30);
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('pointerdown', handlePointerDown);
      clearIdleTimer();
      clearFocusTimers();
    };
  }, [enabled, disabled, scheduleFocus, clearIdleTimer, clearFocusTimers]);

  const handleBlur = () => {
    setFocused(false);
    if (!enabled || disabled) return;
    scheduleFocus(60);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const now = Date.now();
    const delta = now - lastCharAtRef.current;
    if (lastCharAtRef.current > 0 && delta <= FAST_KEY_INTERVAL_MS) {
      fastBurstRef.current = true;
    }
    lastCharAtRef.current = now;
    bufferRef.current = value;

    clearIdleTimer();
    // Submit automatically after 80ms pause when characters arrive quickly (keyboard wedge without Enter)
    if (value.trim().length >= 3) {
      const waitMs = fastBurstRef.current ? BURST_IDLE_MS : 180;
      idleTimerRef.current = window.setTimeout(() => {
        if (fastBurstRef.current || bufferRef.current.trim().length >= 4) {
          flushBuffer();
        }
      }, waitMs);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      flushBuffer();
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      {/* Visually hidden but reliably focusable keyboard-wedge input */}
      <input
        ref={inputRef}
        type="text"
        data-entry-usb-input="true"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="none"
        disabled={!enabled || disabled}
        aria-label={t('entry.usb.inputLabel')}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className="pointer-events-none fixed -top-96 left-0 h-1 w-1 opacity-0"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
              enabled && focused
                ? 'bg-emerald-50 text-emerald-700'
                : enabled
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            <Keyboard className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-base font-bold text-neutral-900">{t('entry.usb.title')}</span>
            <span className="text-xs text-neutral-500">{t('entry.usb.hint')}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {enabled ? (
            <button
              type="button"
              onClick={focusScanner}
              className={`min-h-11 rounded-xl px-3.5 text-sm font-bold transition active:scale-95 ${
                focused
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-amber-500 text-neutral-950 shadow-sm hover:bg-amber-400'
              }`}
            >
              {focused ? t('entry.usb.ready') : t('entry.usb.tapToActivate')}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onToggleEnabled}
            disabled={disabled}
            aria-pressed={enabled}
            aria-label={enabled ? t('entry.usb.turnOff') : t('entry.usb.turnOn')}
            className={`flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition active:scale-95 ${
              enabled
                ? 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
          >
            <Power className="size-4" aria-hidden />
            <span>{enabled ? t('entry.usb.on') : t('entry.usb.off')}</span>
          </button>
        </div>
      </div>

      {enabled ? (
        <label
          data-entry-keep-focus="true"
          className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
        >
          <span>{t('entry.usb.azertyLabel')}</span>
          <input
            type="checkbox"
            checked={azertyFix}
            onChange={onToggleAzertyFix}
            className="size-5 accent-primary-600"
          />
        </label>
      ) : null}
    </div>
  );
}
