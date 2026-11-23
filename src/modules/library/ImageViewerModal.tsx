import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Star,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { getLibraryFileBlob } from '@/db/library';
import type { LibraryMeta } from '@/db/types';
import { downloadBlob } from '@/utils/download';
import { registerAndroidBackHandler } from '@/utils/androidBack';

interface ImageViewerModalProps {
  item: LibraryMeta;
  onClose: () => void;
  onSaveZoom: (id: string, lastZoom: number) => void;
  onToggleFavorite: (item: LibraryMeta) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function clampZoom(value: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)) * 100) / 100;
}

function getTouchDistance(t1: Touch, t2: Touch): number {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

export function ImageViewerModal({
  item,
  onClose,
  onSaveZoom,
  onToggleFavorite,
}: ImageViewerModalProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(() => clampZoom(item.lastZoom || 1));
  const [sharing, setSharing] = useState(false);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSaveZoomRef = useRef(onSaveZoom);
  onSaveZoomRef.current = onSaveZoom;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    const removeBackHandler = registerAndroidBackHandler(() => {
      onCloseRef.current();
      return true;
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      onSaveZoomRef.current(item.id, zoomRef.current);
      removeBackHandler();
    };
  }, [item.id]);

  const loadImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const blob = await getLibraryFileBlob(item);
      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setLoading(false);
    } catch {
      setError(t('library.viewer.corruptOrUnsupported'));
      setLoading(false);
    }
  }, [item, t]);

  useEffect(() => {
    void loadImage();
    return () => {
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [loadImage]);

  // Apply dynamic image width on zoom so native scroll panning works seamlessly
  useEffect(() => {
    const wrap = imgWrapRef.current;
    const scroller = scrollRef.current;
    if (!wrap || !scroller || !naturalSize) return;
    const baseWidth = Math.max(260, scroller.clientWidth - 24);
    const targetWidth = Math.round(baseWidth * zoom);
    wrap.style.width = `${targetWidth}px`;
  }, [naturalSize, zoom]);

  // Pinch-to-zoom & double-tap
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let liveRatio = 1;
    let isPinching = false;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const setLiveTransform = (ratio: number) => {
      const wrap = imgWrapRef.current;
      if (!wrap) return;
      if (Math.abs(ratio - 1) < 0.005) {
        wrap.style.transform = '';
      } else {
        wrap.style.transformOrigin = 'center center';
        wrap.style.transform = `scale(${ratio.toFixed(3)})`;
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        isPinching = true;
        pinchStartDist = Math.max(1, getTouchDistance(event.touches[0], event.touches[1]));
        pinchStartZoom = zoomRef.current;
        liveRatio = 1;
      } else if (event.touches.length === 1 && !isPinching) {
        const now = Date.now();
        const touch = event.touches[0];
        if (now - lastTapTime < 300 && Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY) < 28) {
          lastTapTime = 0;
          setZoom(zoomRef.current > 1.25 ? 1 : 2);
        } else {
          lastTapTime = now;
          lastTapX = touch.clientX;
          lastTapY = touch.clientY;
        }
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isPinching || event.touches.length !== 2) return;
      event.preventDefault();
      const dist = getTouchDistance(event.touches[0], event.touches[1]);
      const target = clampZoom(pinchStartZoom * (dist / pinchStartDist));
      liveRatio = target / Math.max(0.1, pinchStartZoom);
      setLiveTransform(liveRatio);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!isPinching) return;
      if (event.touches.length < 2) {
        isPinching = false;
        const nextZoom = clampZoom(pinchStartZoom * liveRatio);
        setLiveTransform(1);
        setZoom(nextZoom);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const handleOpenExternal = async () => {
    setSharing(true);
    try {
      const blob = blobRef.current ?? (await getLibraryFileBlob(item));
      await downloadBlob(blob, item.fileName || item.title);
    } catch {
      // ignore dismiss
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-[120] flex flex-col bg-slate-950 text-white"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back')}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-200 transition hover:bg-slate-800"
        >
          <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
        </button>

        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white sm:text-base">
          {item.title}
        </h2>

        <button
          type="button"
          onClick={() => onToggleFavorite(item)}
          aria-label={item.favorite ? t('library.actions.unfavorite') : t('library.actions.favorite')}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-200 transition hover:bg-slate-800"
        >
          <Star
            className={`size-5 ${item.favorite ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
            aria-hidden
          />
        </button>

        <button
          type="button"
          disabled={sharing}
          onClick={() => void handleOpenExternal()}
          aria-label={t('library.viewer.openExternal')}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
        >
          <ExternalLink className="size-5" aria-hidden />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex flex-1 items-center justify-center overflow-auto overscroll-contain bg-slate-950 p-3 touch-pan-x touch-pan-y"
      >
        {loading ? (
          <div className="size-8 animate-spin rounded-full border-2 border-slate-600 border-t-primary-400" />
        ) : error ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-danger-900/40 text-danger-400">
              <AlertTriangle className="size-7" aria-hidden />
            </span>
            <h3 className="text-lg font-bold text-white">{t('library.viewer.errorTitle')}</h3>
            <p className="text-sm text-slate-300">{error}</p>
            <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
              <Button
                variant="primary"
                onClick={() => void handleOpenExternal()}
                disabled={sharing}
                icon={<ExternalLink className="size-4" aria-hidden />}
              >
                {t('library.viewer.openExternal')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void loadImage()}
                icon={<RefreshCw className="size-4" aria-hidden />}
              >
                {t('common.retry')}
              </Button>
            </div>
          </div>
        ) : imageUrl ? (
          <div ref={imgWrapRef} className="mx-auto my-auto flex items-center justify-center">
            <img
              src={imageUrl}
              alt={item.title}
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                const img = event.currentTarget;
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setError(t('library.viewer.corruptOrUnsupported'))}
              className="max-h-full w-full rounded-lg object-contain shadow-xl"
            />
          </div>
        ) : null}
      </div>

      {!loading && !error && imageUrl ? (
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-md items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
              aria-label={t('library.viewer.zoomOut')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-100 transition hover:bg-slate-700 disabled:opacity-40"
            >
              <ZoomOut className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="min-h-11 flex-1 rounded-xl bg-slate-800/70 px-3 font-mono text-xs font-semibold tabular-nums text-slate-100 transition hover:bg-slate-800"
              dir="ltr"
            >
              {Math.round(zoom * 100)}% · {t('library.viewer.fitWidth')}
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              aria-label={t('library.viewer.zoomIn')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-100 transition hover:bg-slate-700 disabled:opacity-40"
            >
              <ZoomIn className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
