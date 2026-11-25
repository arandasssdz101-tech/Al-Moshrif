import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Maximize2,
  MoreVertical,
  RefreshCw,
  Star,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { getLibraryFileBlob } from '@/db/library';
import type { LibraryMeta } from '@/db/types';
import { downloadBlob } from '@/utils/download';
import { registerAndroidBackHandler } from '@/utils/androidBack';
import { safeScrollIntoView } from '@/utils/scroll';
import { destroyPdfDocument, openPdfDocument } from './pdfEngine';

interface PdfViewerModalProps {
  item: LibraryMeta;
  onClose: () => void;
  onSaveProgress: (id: string, lastPage: number, lastZoom: number, totalPages?: number) => void;
  onToggleFavorite: (item: LibraryMeta) => void;
}

interface PageDimensions {
  pageNumber: number;
  width: number;
  height: number;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.25;
const DOUBLE_TAP_ZOOM = 2.0;
const FAR_PAGE_DISTANCE = 3;

function clampZoom(value: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)) * 100) / 100;
}

function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

export function PdfViewerModal({
  item,
  onClose,
  onSaveProgress,
  onToggleFavorite,
}: PdfViewerModalProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, RenderTask>>(new Map());
  const renderedKeysRef = useRef<Map<number, string>>(new Map());
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pinchCommitTimerRef = useRef<number | null>(null);
  const initialRestoredRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageDimensions[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(Math.max(1, item.lastPage || 1));
  const [zoom, setZoom] = useState<number>(() => clampZoom(item.lastZoom || 1));
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? Math.max(300, window.innerWidth - 24) : 720,
  );
  const [visibleSetVersion, setVisibleSetVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [sharing, setSharing] = useState(false);

  // Refs synced with latest state for touch handlers & unmount saves
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const pagesLengthRef = useRef(pages.length);
  pagesLengthRef.current = pages.length;
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const jumpOpenRef = useRef(jumpOpen);
  jumpOpenRef.current = jumpOpen;
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;

  // Lock body scroll & listen to Escape + Capacitor Android back button
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (jumpOpenRef.current) setJumpOpen(false);
        else if (menuOpenRef.current) setMenuOpen(false);
        else onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const removeBackHandler = registerAndroidBackHandler(() => {
      if (jumpOpenRef.current) {
        setJumpOpen(false);
        return true;
      }
      if (menuOpenRef.current) {
        setMenuOpen(false);
        return true;
      }
      onCloseRef.current();
      return true;
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      removeBackHandler();
    };
  }, []);

  // Measure available width for fit-to-width calculation
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const updateWidth = () => {
      const next = Math.max(280, Math.min(960, container.clientWidth - 24));
      setViewportWidth(next);
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Load PDF document from Dexie blob or bundled public/library/ asset
  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    initialRestoredRef.current = false;

    // Clean up any previous document
    for (const task of renderTasksRef.current.values()) {
      try {
        task.cancel();
      } catch {
        // ignore cancel errors
      }
    }
    renderTasksRef.current.clear();
    renderedKeysRef.current.clear();
    visiblePagesRef.current.clear();
    if (pdfDocRef.current) {
      await destroyPdfDocument(pdfDocRef.current);
      pdfDocRef.current = null;
    }

    try {
      const blob = await getLibraryFileBlob(item);
      blobRef.current = blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const doc = await openPdfDocument(bytes);
      pdfDocRef.current = doc;

      const dims: PageDimensions[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const vp = page.getViewport({ scale: 1 });
        dims.push({ pageNumber, width: vp.width, height: vp.height });
        page.cleanup();
      }

      setPages(dims);
      const targetPage = Math.min(Math.max(1, item.lastPage || 1), Math.max(1, doc.numPages));
      setCurrentPage(targetPage);
      setLoading(false);
    } catch {
      setError(t('library.viewer.corruptOrUnsupported'));
      setLoading(false);
    }
  }, [item, t]);

  useEffect(() => {
    const tasksMap = renderTasksRef.current;
    void loadDocument();
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (pinchCommitTimerRef.current !== null) window.clearTimeout(pinchCommitTimerRef.current);
      onSaveProgressRef.current(
        item.id,
        currentPageRef.current,
        zoomRef.current,
        pagesLengthRef.current || undefined,
      );
      for (const task of tasksMap.values()) {
        try {
          task.cancel();
        } catch {
          // ignore
        }
      }
      tasksMap.clear();
      if (pdfDocRef.current) {
        void destroyPdfDocument(pdfDocRef.current);
        pdfDocRef.current = null;
      }
    };
  }, [item.id, loadDocument]);

  // Debounced persistence of lastPage & lastZoom
  useEffect(() => {
    if (loading || pages.length === 0) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      onSaveProgressRef.current(item.id, currentPage, zoom, pages.length);
    }, 350);
  }, [currentPage, item.id, loading, pages.length, zoom]);

  // Jump to saved lastPage once pages are mounted
  useEffect(() => {
    if (loading || pages.length === 0 || initialRestoredRef.current) return;
    initialRestoredRef.current = true;
    const savedPage = Math.min(Math.max(1, item.lastPage || 1), pages.length);
    if (savedPage > 1) {
      requestAnimationFrame(() => {
        const el = pageContainerRefs.current.get(savedPage);
        safeScrollIntoView(el, { behavior: 'auto', block: 'start' });
      });
    }
  }, [item.lastPage, loading, pages.length]);

  // Observe visible pages (~1 page vertical rootMargin) and cancel tasks for pages that leave
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) return;

    const marginPx = Math.max(600, Math.round(root.clientHeight || 800));
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const pageNum = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (!pageNum) continue;
          if (entry.isIntersecting) {
            if (!visiblePagesRef.current.has(pageNum)) {
              visiblePagesRef.current.add(pageNum);
              changed = true;
            }
          } else {
            if (visiblePagesRef.current.delete(pageNum)) {
              changed = true;
            }
            const activeTask = renderTasksRef.current.get(pageNum);
            if (activeTask) {
              try {
                activeTask.cancel();
              } catch {
                // ignore
              }
              renderTasksRef.current.delete(pageNum);
            }
          }
        }
        if (changed) {
          setVisibleSetVersion((v) => v + 1);
        }
      },
      {
        root,
        rootMargin: `${marginPx}px 0px ${marginPx}px 0px`,
        threshold: 0.01,
      },
    );

    for (const p of pages) {
      const node = pageContainerRefs.current.get(p.pageNumber);
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [pages]);

  // Track current visible page on scroll
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) return;

    let rafId: number | null = null;
    const computeCurrentPage = () => {
      rafId = null;
      const rootRect = root.getBoundingClientRect();
      const probeY = rootRect.top + rootRect.height * 0.3;
      let bestPage = currentPageRef.current;
      let bestDist = Number.POSITIVE_INFINITY;

      for (const p of pages) {
        const el = pageContainerRefs.current.get(p.pageNumber);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= probeY && rect.bottom >= probeY) {
          bestPage = p.pageNumber;
          break;
        }
        const dist = Math.min(Math.abs(rect.top - probeY), Math.abs(rect.bottom - probeY));
        if (dist < bestDist) {
          bestDist = dist;
          bestPage = p.pageNumber;
        }
      }
      if (bestPage !== currentPageRef.current) {
        setCurrentPage(bestPage);
      }
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(computeCurrentPage);
    };

    root.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [pages]);

  // Render visible pages & release canvases far from currentPage
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || pages.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let cancelled = false;

    // Release far canvases to conserve mobile memory
    for (const p of pages) {
      const num = p.pageNumber;
      const isVisible = visiblePagesRef.current.has(num);
      const isFar = Math.abs(num - currentPage) > FAR_PAGE_DISTANCE;
      if (!isVisible && isFar) {
        const running = renderTasksRef.current.get(num);
        if (running) {
          try {
            running.cancel();
          } catch {
            // ignore
          }
          renderTasksRef.current.delete(num);
        }
        const canvas = canvasRefs.current.get(num);
        if (canvas && (canvas.width > 0 || canvas.height > 0)) {
          canvas.width = 0;
          canvas.height = 0;
        }
        renderedKeysRef.current.delete(num);
      }
    }

    const renderVisiblePages = async () => {
      const toRender = Array.from(visiblePagesRef.current).sort(
        (a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage),
      );

      for (const pageNum of toRender) {
        if (cancelled) return;
        const pageDim = pages[pageNum - 1];
        const canvas = canvasRefs.current.get(pageNum);
        if (!pageDim || !canvas) continue;

        const fitScale = viewportWidth / Math.max(1, pageDim.width);
        const cssScale = fitScale * zoom;
        const renderScale = cssScale * dpr;
        const cacheKey = `${Math.round(viewportWidth)}-${zoom.toFixed(2)}-${dpr.toFixed(2)}`;

        if (renderedKeysRef.current.get(pageNum) === cacheKey && canvas.width > 0) {
          continue;
        }

        const existingTask = renderTasksRef.current.get(pageNum);
        if (existingTask) {
          try {
            existingTask.cancel();
          } catch {
            // ignore
          }
          renderTasksRef.current.delete(pageNum);
        }

        try {
          const page = await doc.getPage(pageNum);
          if (cancelled || !visiblePagesRef.current.has(pageNum)) {
            page.cleanup();
            continue;
          }

          const viewport = page.getViewport({ scale: renderScale });
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));

          const task = page.render({ canvas, viewport });
          renderTasksRef.current.set(pageNum, task);
          await task.promise;

          if (renderTasksRef.current.get(pageNum) === task) {
            renderTasksRef.current.delete(pageNum);
          }
          renderedKeysRef.current.set(pageNum, cacheKey);
          page.cleanup();
        } catch (err) {
          const name = (err as { name?: string })?.name;
          if (name !== 'RenderingCancelledException') {
            // Non-cancellation error on page render
          }
        }
      }
    };

    void renderVisiblePages();

    return () => {
      cancelled = true;
    };
  }, [currentPage, pages, viewportWidth, visibleSetVersion, zoom]);

  // Pinch-to-zoom (CSS transform during gesture -> debounced re-render on end) + Double-tap toggle
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

    const applyTransform = (ratio: number) => {
      const content = contentRef.current;
      if (!content) return;
      if (Math.abs(ratio - 1) < 0.005) {
        content.style.transform = '';
        content.style.transformOrigin = '';
      } else {
        content.style.transformOrigin = 'top center';
        content.style.transform = `scale(${ratio.toFixed(3)})`;
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        isPinching = true;
        pinchStartDist = Math.max(1, getTouchDistance(event.touches[0], event.touches[1]));
        pinchStartZoom = zoomRef.current;
        liveRatio = 1;
        if (pinchCommitTimerRef.current !== null) {
          window.clearTimeout(pinchCommitTimerRef.current);
          pinchCommitTimerRef.current = null;
        }
      } else if (event.touches.length === 1 && !isPinching) {
        const now = Date.now();
        const touch = event.touches[0];
        const dt = now - lastTapTime;
        const dist = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);
        if (dt > 0 && dt < 300 && dist < 28) {
          lastTapTime = 0;
          const nextZoom = zoomRef.current > 1.25 ? 1.0 : DOUBLE_TAP_ZOOM;
          setZoom(nextZoom);
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
      const currentDist = getTouchDistance(event.touches[0], event.touches[1]);
      const targetZoom = clampZoom(pinchStartZoom * (currentDist / pinchStartDist));
      liveRatio = targetZoom / Math.max(0.1, pinchStartZoom);
      applyTransform(liveRatio);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!isPinching) return;
      if (event.touches.length < 2) {
        isPinching = false;
        const finalZoom = clampZoom(pinchStartZoom * liveRatio);
        if (pinchCommitTimerRef.current !== null) {
          window.clearTimeout(pinchCommitTimerRef.current);
        }
        pinchCommitTimerRef.current = window.setTimeout(() => {
          applyTransform(1);
          setZoom(finalZoom);
        }, 140);
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
      await downloadBlob(blob, item.fileName || `${item.title}.pdf`);
    } catch {
      // handled silently if share sheet is dismissed
    } finally {
      setSharing(false);
    }
  };

  const scrollToPage = (pageNum: number) => {
    const clamped = Math.min(Math.max(1, pageNum), Math.max(1, pages.length));
    setCurrentPage(clamped);
    const el = pageContainerRefs.current.get(clamped);
    safeScrollIntoView(el, { behavior: 'smooth', block: 'start' });
  };

  const handleJumpSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number.parseInt(jumpValue.trim(), 10);
    if (Number.isFinite(parsed)) {
      scrollToPage(parsed);
    }
    setJumpOpen(false);
  };

  const pageLayout = useMemo(() => {
    return pages.map((page) => {
      const fitScale = viewportWidth / Math.max(1, page.width);
      const displayWidth = Math.round(page.width * fitScale * zoom);
      const displayHeight = Math.round(page.height * fitScale * zoom);
      return { pageNumber: page.pageNumber, displayWidth, displayHeight };
    });
  }, [pages, viewportWidth, zoom]);

  const zoomPercent = Math.round(zoom * 100);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-[120] flex flex-col bg-slate-950 text-white"
    >
      {/* Top App Bar */}
      <header className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
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

        {pages.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setJumpValue(String(currentPage));
              setJumpOpen(true);
            }}
            aria-label={t('library.viewer.jumpToPage')}
            className="min-h-10 shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 font-mono text-xs font-semibold tabular-nums text-slate-100 transition hover:bg-slate-700"
            dir="ltr"
          >
            {currentPage} / {pages.length}
          </button>
        ) : null}

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={t('library.viewer.menu')}
            aria-expanded={menuOpen}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-200 transition hover:bg-slate-800"
          >
            <MoreVertical className="size-5" aria-hidden />
          </button>

          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute end-0 top-12 z-20 flex w-56 flex-col rounded-2xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl">
                {pages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setJumpValue(String(currentPage));
                      setJumpOpen(true);
                    }}
                    className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm text-slate-100 hover:bg-slate-800"
                  >
                    <span>{t('library.viewer.jumpToPage')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setZoom(1);
                  }}
                  className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm text-slate-100 hover:bg-slate-800"
                >
                  <Maximize2 className="size-4 text-slate-400" aria-hidden />
                  <span>{t('library.viewer.fitWidth')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleFavorite(item);
                  }}
                  className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm text-slate-100 hover:bg-slate-800"
                >
                  <Star
                    className={`size-4 ${item.favorite ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`}
                    aria-hidden
                  />
                  <span>
                    {item.favorite
                      ? t('library.actions.unfavorite')
                      : t('library.actions.favorite')}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={sharing}
                  onClick={() => {
                    setMenuOpen(false);
                    void handleOpenExternal();
                  }}
                  className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-50"
                >
                  <ExternalLink className="size-4 text-slate-400" aria-hidden />
                  <span>{t('library.viewer.openExternal')}</span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/* Main Continuous Scroll Viewport */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto overscroll-contain bg-slate-950 p-3 touch-pan-x touch-pan-y"
      >
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300">
            <div className="size-8 animate-spin rounded-full border-2 border-slate-600 border-t-primary-400" />
            <p className="text-sm">{t('library.viewer.loading')}</p>
          </div>
        ) : error ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
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
                onClick={() => void loadDocument()}
                icon={<RefreshCw className="size-4" aria-hidden />}
              >
                {t('common.retry')}
              </Button>
            </div>
          </div>
        ) : (
          <div
            ref={contentRef}
            className="mx-auto flex min-w-fit flex-col items-center gap-3 pb-24"
          >
            {pageLayout.map(({ pageNumber, displayWidth, displayHeight }) => (
              <div
                key={pageNumber}
                data-page-number={pageNumber}
                ref={(el) => {
                  if (el) {
                    pageContainerRefs.current.set(pageNumber, el);
                    el.style.width = `${displayWidth}px`;
                    el.style.height = `${displayHeight}px`;
                  } else {
                    pageContainerRefs.current.delete(pageNumber);
                  }
                }}
                className="relative shrink-0 overflow-hidden rounded-lg bg-[#ffffff] shadow-lg ring-1 ring-slate-800"
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(pageNumber, el);
                    else canvasRefs.current.delete(pageNumber);
                  }}
                  className="block size-full"
                />
                <span className="pointer-events-none absolute bottom-2 end-2 rounded bg-slate-900/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">
                  {pageNumber}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Zoom Bar respecting Safe Area */}
      {!loading && !error && pages.length > 0 ? (
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
              aria-label={t('library.viewer.fitWidth')}
              className="min-h-11 flex-1 rounded-xl bg-slate-800/70 px-3 font-mono text-xs font-semibold tabular-nums text-slate-100 transition hover:bg-slate-800"
              dir="ltr"
            >
              {zoomPercent}% · {t('library.viewer.fitWidth')}
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

      {/* Jump to Page Modal */}
      <Modal
        open={jumpOpen}
        title={t('library.viewer.jumpToPage')}
        description={t('library.viewer.jumpHint', { total: pages.length })}
        onClose={() => setJumpOpen(false)}
      >
        <form onSubmit={handleJumpSubmit} className="flex flex-col gap-4">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={pages.length}
            value={jumpValue}
            onChange={(event) => setJumpValue(event.target.value)}
            autoFocus
            className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-center font-mono text-lg font-bold tabular-nums text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            dir="ltr"
          />
          <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setJumpOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('library.viewer.go')}</Button>
          </div>
        </form>
      </Modal>
    </div>,
    document.body,
  );
}
