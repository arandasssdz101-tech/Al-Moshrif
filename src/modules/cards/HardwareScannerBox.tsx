import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { FlaskConical, Keyboard, QrCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { normalizeScannedCode } from '@/utils/studentQr';

const AZERTY_STORAGE_KEY = 'edutrack_azerty_scanner_fix';
const FAST_CHAR_INTERVAL_MS = 45;
const BURST_IDLE_SUBMIT_MS = 80;
const MIN_FAST_INTERVALS_FOR_BURST = 2;

export interface LastScanDiagnostic {
  raw: string;
  normalized: string;
  length: number;
  found: boolean;
  studentName?: string;
}

interface HardwareScannerBoxProps {
  /** Pause auto-refocusing while a modal or camera scanner is open */
  paused: boolean;
  /** Optional ref to the parent screen element for tap-outside-inputs refocus */
  screenRef: React.RefObject<HTMLDivElement>;
  /** Called with raw text and normalized text when a scan is submitted */
  onScanSubmit: (rawText: string, normalizedText: string) => void;
  /** Called when the user clicks the Test button to simulate a scan */
  onSimulateTestScan: (convertAzertyDigits: boolean) => void;
  /** Last scan diagnostic record (null before first scan) */
  lastDiagnostic: LastScanDiagnostic | null;
  /** Optional footer slot (e.g. card-absence toggle) */
  footer?: React.ReactNode;
}

function readAzertyPref(): boolean {
  try {
    const stored = window.localStorage.getItem(AZERTY_STORAGE_KEY);
    if (stored === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

function formatRawForDisplay(raw: string): string {
  return raw.replace(/\r/g, '↵').replace(/\n/g, '↵').replace(/\t/g, '⇥');
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a, label, [role="button"], [role="switch"], [contenteditable="true"]',
    ),
  );
}

export function HardwareScannerBox({
  paused,
  screenRef,
  onScanSubmit,
  onSimulateTestScan,
  lastDiagnostic,
  footer,
}: HardwareScannerBoxProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [showSoftKeyboard, setShowSoftKeyboard] = useState(false);
  const [azertyFix, setAzertyFix] = useState<boolean>(readAzertyPref);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastCharTimeRef = useRef<number>(0);
  const fastIntervalCountRef = useRef<number>(0);
  const prevLengthRef = useRef<number>(0);
  const burstTimerRef = useRef<number | null>(null);
  const latestValueRef = useRef<string>('');
  const wasPausedRef = useRef<boolean>(paused);
  const focusTimersRef = useRef<Set<number>>(new Set());

  const clearFocusTimers = useCallback(() => {
    for (const timer of focusTimersRef.current) {
      window.clearTimeout(timer);
    }
    focusTimersRef.current.clear();
  }, []);

  const scheduleTimer = useCallback((fn: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      focusTimersRef.current.delete(timer);
      fn();
    }, delayMs);
    focusTimersRef.current.add(timer);
  }, []);

  const clearBurstState = useCallback(() => {
    if (burstTimerRef.current !== null) {
      window.clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    lastCharTimeRef.current = 0;
    fastIntervalCountRef.current = 0;
    prevLengthRef.current = 0;
  }, []);

  const focusInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    setFocused(document.activeElement === input);
  }, []);

  const submitCurrent = useCallback(
    (rawToSubmit: string) => {
      clearBurstState();
      setValue('');
      latestValueRef.current = '';
      if (!rawToSubmit.trim() && !normalizeScannedCode(rawToSubmit, { convertAzertyDigits: azertyFix })) {
        if (!paused) scheduleTimer(focusInput, 0);
        return;
      }
      const normalized = normalizeScannedCode(rawToSubmit, { convertAzertyDigits: azertyFix });
      onScanSubmit(rawToSubmit, normalized);
      // Refocus immediately after scan (unless parent opened a modal, in which case paused effect handles refocus on close)
      scheduleTimer(() => {
        if (!paused) focusInput();
      }, 20);
    },
    [azertyFix, clearBurstState, focusInput, onScanSubmit, paused, scheduleTimer],
  );

  // Autofocus on mount
  useEffect(() => {
    if (!paused) {
      const timer = window.setTimeout(focusInput, 40);
      return () => window.clearTimeout(timer);
    }
  }, [focusInput, paused]);

  // Refocus when modal/camera closes (paused: true -> false)
  useEffect(() => {
    if (wasPausedRef.current && !paused) {
      const timer = window.setTimeout(focusInput, 50);
      wasPausedRef.current = paused;
      return () => window.clearTimeout(timer);
    }
    wasPausedRef.current = paused;
  }, [paused, focusInput]);

  // Refocus on window focus
  useEffect(() => {
    const handleWindowFocus = () => {
      if (paused) return;
      const active = document.activeElement;
      if (!active || active === document.body || active === inputRef.current) {
        focusInput();
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [paused, focusInput]);

  // Refocus when tapping anywhere outside inputs/buttons on this screen
  useEffect(() => {
    const container = screenRef.current;
    if (!container) return;
    const handleScreenPointerDown = (event: PointerEvent) => {
      if (paused) return;
      if (event.target === inputRef.current) return;
      if (isInteractiveTarget(event.target)) return;
      scheduleTimer(focusInput, 0);
    };
    container.addEventListener('pointerdown', handleScreenPointerDown);
    return () => container.removeEventListener('pointerdown', handleScreenPointerDown);
  }, [paused, screenRef, focusInput, scheduleTimer]);

  // Cleanup burst & focus timers on unmount
  useEffect(() => {
    return () => {
      clearBurstState();
      clearFocusTimers();
    };
  }, [clearBurstState, clearFocusTimers]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    const now = performance.now();
    const addedChars = next.length - prevLengthRef.current;
    prevLengthRef.current = next.length;
    latestValueRef.current = next;
    setValue(next);

    if (burstTimerRef.current !== null) {
      window.clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }

    if (addedChars === 1) {
      const delta = lastCharTimeRef.current > 0 ? now - lastCharTimeRef.current : Infinity;
      if (delta <= FAST_CHAR_INTERVAL_MS) {
        fastIntervalCountRef.current += 1;
      } else {
        fastIntervalCountRef.current = 0;
      }
      lastCharTimeRef.current = now;

      if (fastIntervalCountRef.current >= MIN_FAST_INTERVALS_FOR_BURST && next.trim().length > 0) {
        burstTimerRef.current = window.setTimeout(() => {
          submitCurrent(latestValueRef.current);
        }, BURST_IDLE_SUBMIT_MS);
      }
    } else if (addedChars > 1) {
      // Multi-char burst in a single input event (Bluetooth/Android HID wedges often batch chars)
      lastCharTimeRef.current = now;
      if (!showSoftKeyboard && next.trim().length >= 3) {
        fastIntervalCountRef.current = MIN_FAST_INTERVALS_FOR_BURST;
        burstTimerRef.current = window.setTimeout(() => {
          submitCurrent(latestValueRef.current);
        }, BURST_IDLE_SUBMIT_MS);
      } else {
        fastIntervalCountRef.current = 0;
      }
    } else {
      lastCharTimeRef.current = 0;
      fastIntervalCountRef.current = 0;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'NumpadEnter' || event.code === 'NumpadEnter' || event.key === 'Tab') {
      event.preventDefault();
      submitCurrent(latestValueRef.current || value);
    }
  };

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitCurrent(latestValueRef.current || value);
  };

  const handleToggleSoftKeyboard = () => {
    const next = !showSoftKeyboard;
    setShowSoftKeyboard(next);
    const input = inputRef.current;
    if (!input) return;
    // Blur + refocus ensures mobile browsers apply the updated inputMode immediately
    input.blur();
    scheduleTimer(() => {
      const target = inputRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      setFocused(document.activeElement === target);
    }, 20);
  };

  const handleToggleAzerty = () => {
    const next = !azertyFix;
    setAzertyFix(next);
    try {
      window.localStorage.setItem(AZERTY_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  };

  return (
    <section className="relative z-10 flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm pointer-events-auto">
      {/* Header row with status badge + quick actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <QrCode className="size-5 shrink-0 text-primary-700" aria-hidden />
          <span className="text-sm font-semibold text-neutral-900">{t('cards.hardwareScanner.title')}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={focusInput}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              focused
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <span
              className={`size-2 rounded-full ${focused ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}
              aria-hidden
            />
            <span>{focused ? t('cards.hardwareScanner.statusReady') : t('cards.hardwareScanner.statusTapToActivate')}</span>
          </button>

          <button
            type="button"
            onClick={() => onSimulateTestScan(azertyFix)}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100"
          >
            <FlaskConical className="size-3.5 text-primary-700" aria-hidden />
            <span>{t('cards.hardwareScanner.testButton')}</span>
          </button>
        </div>
      </div>

      {/* Main scanner input row — always enabled, visible border + focus ring */}
      <form onSubmit={handleFormSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div
          onClick={focusInput}
          className="relative flex min-w-0 flex-1 items-center pointer-events-auto"
        >
          <input
            ref={inputRef}
            type="text"
            inputMode={showSoftKeyboard ? 'text' : 'none'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t('cards.hardwareScannerPlaceholder')}
            aria-label={t('cards.hardwareScannerPlaceholder')}
            className={`min-h-12 w-full rounded-xl border-2 bg-white ps-3.5 pe-12 text-sm font-medium text-neutral-900 placeholder:text-neutral-400 transition focus:outline-none pointer-events-auto ${
              focused
                ? 'border-emerald-500 ring-4 ring-emerald-500/15'
                : 'border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15'
            }`}
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleToggleSoftKeyboard();
            }}
            title={
              showSoftKeyboard
                ? t('cards.hardwareScanner.hideKeyboard')
                : t('cards.hardwareScanner.showKeyboard')
            }
            aria-label={
              showSoftKeyboard
                ? t('cards.hardwareScanner.hideKeyboard')
                : t('cards.hardwareScanner.showKeyboard')
            }
            aria-pressed={showSoftKeyboard}
            className={`absolute end-1.5 inline-flex size-9 items-center justify-center rounded-lg border transition ${
              showSoftKeyboard
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <Keyboard className="size-4" aria-hidden />
          </button>
        </div>

        <Button type="submit" variant="primary" className="shrink-0 sm:min-w-28">
          {t('cards.lookupCode')}
        </Button>
      </form>

      {/* Options & Diagnostic monospace line */}
      <div className="flex flex-col gap-2 text-xs text-neutral-600">
        <label className="inline-flex cursor-pointer items-center gap-2 self-start select-none">
          <input
            type="checkbox"
            checked={azertyFix}
            onChange={handleToggleAzerty}
            className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          <span>{t('cards.hardwareScanner.azertyLabel')}</span>
        </label>

        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 font-mono text-[11px] text-neutral-700"
        >
          <span className="font-sans font-semibold text-neutral-500">
            {t('cards.hardwareScanner.lastScanLabel')}:
          </span>
          {lastDiagnostic ? (
            <>
              <span
                dir="ltr"
                className="max-w-full truncate rounded bg-white px-1.5 py-0.5 text-neutral-900 ring-1 ring-neutral-200"
                title={lastDiagnostic.raw}
              >
                {formatRawForDisplay(lastDiagnostic.raw) || '""'}
              </span>
              <span className="tabular-nums text-neutral-500" dir="ltr">
                ({t('cards.hardwareScanner.lengthLabel', { count: lastDiagnostic.length })})
              </span>
              <span
                className={`font-sans font-semibold ${
                  lastDiagnostic.found ? 'text-emerald-700' : 'text-danger-700'
                }`}
              >
                {lastDiagnostic.found
                  ? t('cards.hardwareScanner.resultFound', { name: lastDiagnostic.studentName ?? '' })
                  : t('cards.hardwareScanner.resultNotFound')}
              </span>
            </>
          ) : (
            <span className="font-sans text-neutral-400">{t('cards.hardwareScanner.noScanYet')}</span>
          )}
        </div>
      </div>

      {footer ? <div className="border-t border-neutral-100 pt-3">{footer}</div> : null}
    </section>
  );
}
