import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  SwitchCamera,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { registerAndroidBackHandler } from '@/utils/androidBack';

interface BrowserBarcodeDetector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BrowserBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

interface EntryCameraScannerProps {
  active: boolean;
  cooldownSeconds: number;
  disabled?: boolean;
  onDetect: (rawCode: string) => void;
  onToggleActive: () => void;
}

const DESIRED_BARCODE_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'itf', 'data_matrix', 'pdf_417'];

export function EntryCameraScanner({
  active,
  cooldownSeconds,
  disabled = false,
  onDetect,
  onToggleActive,
}: EntryCameraScannerProps) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'denied' | 'unsupported' | 'error'>('idle');
  const [engineLabel, setEngineLabel] = useState<'native' | 'zxing' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [hiddenPause, setHiddenPause] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const pausedRef = useRef(paused);
  const onDetectRef = useRef(onDetect);
  const cooldownMsRef = useRef(cooldownSeconds * 1000);
  const seenCodesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    cooldownMsRef.current = Math.max(0, cooldownSeconds) * 1000;
  }, [cooldownSeconds]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const removeBack = registerAndroidBackHandler(() => {
      setExpanded(false);
      return true;
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      removeBack();
    };
  }, [expanded]);

  const emitCode = useCallback((rawValue: string) => {
    const cleaned = rawValue.trim();
    if (!cleaned || pausedRef.current) return;
    const now = Date.now();
    const cooldownMs = cooldownMsRef.current;

    // Clean stale cooldown entries occasionally
    if (seenCodesRef.current.size > 200) {
      for (const [key, ts] of seenCodesRef.current.entries()) {
        if (now - ts > Math.max(cooldownMs, 10_000)) {
          seenCodesRef.current.delete(key);
        }
      }
    }

    const lastSeen = seenCodesRef.current.get(cleaned);
    if (lastSeen !== undefined && now - lastSeen < cooldownMs) {
      return;
    }
    seenCodesRef.current.set(cleaned, now);
    onDetectRef.current(cleaned);
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (sentinel && !sentinel.released) {
      await sentinel.release().catch(() => undefined);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;
    try {
      await releaseWakeLock();
      wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch {
      // Wake Lock not permitted or unsupported
    }
  }, [releaseWakeLock]);

  const stopCameraResources = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    trackRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchAvailable(false);
    void releaseWakeLock();
  }, [releaseWakeLock]);

  // Stop camera immediately when page/tab becomes hidden, resume when visible again
  useEffect(() => {
    if (!active) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setHiddenPause(true);
      } else {
        setHiddenPause(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active]);

  const shouldRun = active && !disabled && !hiddenPause;

  useEffect(() => {
    if (!shouldRun) {
      stopCameraResources();
      if (!active) {
        setStatus('idle');
        setEngineLabel(null);
      }
      return;
    }

    let cancelled = false;
    let rafOrTimer: number | null = null;
    let zxingControls: { stop: () => void } | null = null;

    const cleanupLocal = () => {
      if (rafOrTimer !== null) {
        window.clearTimeout(rafOrTimer);
        rafOrTimer = null;
      }
      if (zxingControls) {
        try {
          zxingControls.stop();
        } catch {
          // ignore
        }
        zxingControls = null;
      }
      stopCameraResources();
    };

    const start = async () => {
      setStatus('starting');
      setErrorMessage(null);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus('unsupported');
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        // Retry without ideal resolution constraint if device rejects 1280x720
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing },
            audio: false,
          });
        } catch (err2) {
          if (cancelled) return;
          const msg = err2 instanceof Error ? err2.message : err instanceof Error ? err.message : String(err2);
          setErrorMessage(msg);
          const lower = msg.toLowerCase();
          setStatus(lower.includes('denied') || lower.includes('permission') || lower.includes('notallowed') ? 'denied' : 'error');
          return;
        }
      }

      if (cancelled || !stream) {
        stream?.getTracks().forEach((tr) => tr.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      if (track) {
        const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchAvailable(Boolean(capabilities.torch));
      }

      const video = videoRef.current;
      if (!video) {
        cleanupLocal();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      if (cancelled) {
        cleanupLocal();
        return;
      }

      await requestWakeLock();
      setStatus('running');

      // Primary: Browser BarcodeDetector API when available & supports desired formats
      const DetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      let detector: BrowserBarcodeDetector | null = null;
      if (DetectorCtor) {
        try {
          let formats = DESIRED_BARCODE_FORMATS;
          if (typeof DetectorCtor.getSupportedFormats === 'function') {
            const supported = await DetectorCtor.getSupportedFormats();
            const intersection = DESIRED_BARCODE_FORMATS.filter((fmt) => supported.includes(fmt));
            if (intersection.length > 0) {
              formats = intersection;
            }
          }
          detector = new DetectorCtor({ formats });
        } catch {
          detector = null;
        }
      }

      if (cancelled) {
        cleanupLocal();
        return;
      }

      if (detector) {
        setEngineLabel('native');
        let detecting = false;
        const tick = async () => {
          if (cancelled) return;
          const src = videoRef.current;
          if (src && src.readyState >= 2 && !pausedRef.current && !detecting) {
            detecting = true;
            try {
              const codes = await detector.detect(src);
              // Handle several codes in one frame sequentially
              for (const item of codes) {
                if (item.rawValue) {
                  emitCode(item.rawValue);
                }
              }
            } catch {
              // Ignore single-frame detection errors
            } finally {
              detecting = false;
            }
          }
          if (!cancelled) {
            rafOrTimer = window.setTimeout(() => {
              void tick();
            }, 130);
          }
        };
        void tick();
        return;
      }

      // Fallback: bundled @zxing/browser + @zxing/library (no CDN)
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled) {
          cleanupLocal();
          return;
        }
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.ITF,
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.PDF_417,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.CHARACTER_SET, 'UTF-8');

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 160,
          delayBetweenScanSuccess: 200,
        });
        setEngineLabel('zxing');
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (cancelled || pausedRef.current) return;
          if (result) {
            emitCode(result.getText());
          }
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        zxingControls = controls;
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      cleanupLocal();
    };
  }, [shouldRun, active, facing, retryToken, emitCode, requestWakeLock, stopCameraResources]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || !torchAvailable) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Torch constraint unsupported on this lens
    }
  };

  const switchFacing = () => {
    setTorchOn(false);
    setFacing((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  if (!active) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
            <CameraOff className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-base font-bold text-neutral-900">{t('entry.camera.title')}</span>
            <span className="text-xs text-neutral-500">{t('entry.camera.offHint')}</span>
          </div>
        </div>
        <Button
          type="button"
          onClick={onToggleActive}
          disabled={disabled}
          icon={<Camera className="size-4" aria-hidden />}
        >
          {t('entry.camera.turnOn')}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 text-white shadow-sm ${
        expanded ? 'fixed inset-0 z-50 flex flex-col rounded-none border-0' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-900/95 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${
              status === 'running' && !paused
                ? 'bg-emerald-400 animate-pulse'
                : paused
                  ? 'bg-amber-400'
                  : 'bg-neutral-500'
            }`}
          />
          <span className="text-sm font-bold">
            {paused
              ? t('entry.camera.paused')
              : status === 'running'
                ? t('entry.camera.live')
                : t('entry.camera.starting')}
          </span>
          {engineLabel ? (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">
              {engineLabel === 'native' ? 'BarcodeDetector' : 'ZXing'}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaused((prev) => !prev)}
            aria-label={paused ? t('entry.camera.resume') : t('entry.camera.pause')}
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-sm font-semibold text-white transition hover:bg-white/25 active:scale-95"
          >
            {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            <span>{paused ? t('entry.camera.resume') : t('entry.camera.pause')}</span>
          </button>

          {torchAvailable ? (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-label={torchOn ? t('entry.camera.torchOff') : t('entry.camera.torchOn')}
              aria-pressed={torchOn}
              className={`flex size-11 items-center justify-center rounded-xl transition active:scale-95 ${
                torchOn ? 'bg-amber-500 text-neutral-950' : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              {torchOn ? <FlashlightOff className="size-5" aria-hidden /> : <Flashlight className="size-5" aria-hidden />}
            </button>
          ) : null}

          <button
            type="button"
            onClick={switchFacing}
            aria-label={t('entry.camera.switchCamera')}
            className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-white transition hover:bg-white/25 active:scale-95"
          >
            <SwitchCamera className="size-5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? t('entry.camera.exitFullscreen') : t('entry.camera.fullscreen')}
            className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-white transition hover:bg-white/25 active:scale-95"
          >
            {expanded ? <Minimize2 className="size-5" aria-hidden /> : <Maximize2 className="size-5" aria-hidden />}
          </button>

          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              onToggleActive();
            }}
            aria-label={t('entry.camera.turnOff')}
            className="flex size-11 items-center justify-center rounded-xl bg-danger-600/80 text-white transition hover:bg-danger-600 active:scale-95"
          >
            <CameraOff className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className={`relative w-full overflow-hidden bg-black ${expanded ? 'flex-1' : 'aspect-[16/10] sm:aspect-[16/9]'}`}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-cover"
        />

        {status === 'running' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div
              className={`h-44 w-64 max-w-[85%] rounded-2xl border-4 transition-colors sm:h-52 sm:w-80 ${
                paused ? 'border-amber-400/80 bg-black/40' : 'border-emerald-400/90'
              }`}
            />
          </div>
        ) : null}

        {paused && status === 'running' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <button
              type="button"
              onClick={() => setPaused(false)}
              className="flex min-h-14 items-center gap-2 rounded-2xl bg-amber-500 px-6 text-base font-bold text-neutral-950 shadow-lg active:scale-95"
            >
              <Play className="size-5" aria-hidden />
              {t('entry.camera.resume')}
            </button>
          </div>
        ) : null}

        {status === 'denied' || status === 'unsupported' || status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/90 p-5 text-center">
            <p className="text-base font-bold text-danger-300">
              {status === 'denied'
                ? t('entry.camera.denied')
                : status === 'unsupported'
                  ? t('entry.camera.unsupported')
                  : t('entry.camera.error')}
            </p>
            {errorMessage ? <p className="max-w-sm break-words font-mono text-xs text-white/70">{errorMessage}</p> : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetryToken((prev) => prev + 1)}
              icon={<RefreshCw className="size-4" aria-hidden />}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
