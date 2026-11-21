import { useEffect, useState } from 'react';
import {
  ExternalLink,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  FileText,
  MoreVertical,
  Pencil,
  Presentation,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getLibraryFileBlob } from '@/db/library';
import type { LibraryMeta } from '@/db/types';
import {
  classifyViewerKind,
  formatFileSize,
  getFileExtension,
} from '@/utils/libraryHelpers';
import { generateImageThumbnail, renderPdfFirstPageThumbnail } from './pdfEngine';

interface LibraryCardProps {
  item: LibraryMeta;
  canManage: boolean;
  onOpen: (item: LibraryMeta) => void;
  onOpenExternal: (item: LibraryMeta) => void;
  onToggleFavorite: (item: LibraryMeta) => void;
  onEdit: (item: LibraryMeta) => void;
  onRequestDeleteOrHide: (item: LibraryMeta) => void;
  onThumbnailReady: (id: string, thumbnail: string, pages?: number | null) => void;
}

const inFlightThumbnails = new Set<string>();

function formatShortDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale.startsWith('ar') ? 'ar-DZ' : 'en-GB', {
      day: '2-digit',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function LibraryCard({
  item,
  canManage,
  onOpen,
  onOpenExternal,
  onToggleFavorite,
  onEdit,
  onRequestDeleteOrHide,
  onThumbnailReady,
}: LibraryCardProps) {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const viewerKind = classifyViewerKind(item.mime, item.fileName);
  const ext = getFileExtension(item.fileName).toUpperCase();

  // Lazily generate & cache first-page thumbnail for PDFs and images if not yet generated
  useEffect(() => {
    if (item.thumbnail || viewerKind === 'external') return;
    if (inFlightThumbnails.has(item.id)) return;

    let cancelled = false;
    inFlightThumbnails.add(item.id);

    const run = async () => {
      try {
        const blob = await getLibraryFileBlob(item);
        if (cancelled) return;
        if (viewerKind === 'pdf') {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const result = await renderPdfFirstPageThumbnail(bytes);
          if (!cancelled && result?.dataUrl) {
            onThumbnailReady(item.id, result.dataUrl, result.numPages);
          }
        } else if (viewerKind === 'image') {
          const dataUrl = await generateImageThumbnail(blob);
          if (!cancelled && dataUrl) {
            onThumbnailReady(item.id, dataUrl);
          }
        }
      } catch {
        // Fallback icon will remain displayed cleanly
      } finally {
        inFlightThumbnails.delete(item.id);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [item, onThumbnailReady, viewerKind]);

  const FallbackIcon =
    viewerKind === 'image'
      ? FileImage
      : ext === 'XLS' || ext === 'XLSX' || ext === 'CSV'
        ? FileSpreadsheet
        : ext === 'PPT' || ext === 'PPTX'
          ? Presentation
          : FileText;

  return (
    <article className="relative flex items-stretch gap-3.5 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-neutral-200 transition hover:shadow-md">
      {/* Thumbnail Preview (opens document on tap) */}
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={item.title}
        className="relative flex w-20 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/80 transition active:scale-[0.98]"
      >
        <div className="aspect-[3/4] w-full overflow-hidden">
          {item.thumbnail && !thumbFailed ? (
            <img
              src={item.thumbnail}
              alt={item.title}
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
              className="size-full bg-[#ffffff] object-cover object-top"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-primary-50 to-neutral-100 p-2 text-primary-700">
              <FallbackIcon className="size-7 shrink-0" aria-hidden />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                {ext || (viewerKind === 'pdf' ? 'PDF' : 'FILE')}
              </span>
            </div>
          )}
        </div>
      </button>

      {/* Content & Metadata */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div className="flex items-start justify-between gap-1.5">
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex min-w-0 flex-1 flex-col gap-1 text-start"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {item.builtIn ? (
                <span className="inline-flex items-center rounded-md bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700 ring-1 ring-inset ring-primary-200">
                  {t('library.builtInBadge')}
                </span>
              ) : null}
              <span className="text-xs font-medium text-neutral-500">
                {t(`library.categories.${item.category}`)}
              </span>
            </div>
            <h3 className="line-clamp-2 text-sm font-bold leading-snug text-neutral-900 sm:text-base">
              {item.title}
            </h3>
          </button>

          {/* Favorite Star + Overflow Menu */}
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => onToggleFavorite(item)}
              aria-label={
                item.favorite ? t('library.actions.unfavorite') : t('library.actions.favorite')
              }
              aria-pressed={item.favorite}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-neutral-400 transition hover:bg-neutral-100 hover:text-amber-500"
            >
              <Star
                className={`size-5 ${item.favorite ? 'fill-amber-400 text-amber-500' : ''}`}
                aria-hidden
              />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label={t('library.actions.more')}
                aria-expanded={menuOpen}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
              >
                <MoreVertical className="size-5" aria-hidden />
              </button>

              {menuOpen ? (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                  <div className="absolute end-0 top-11 z-30 flex w-52 flex-col rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-neutral-200">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenExternal(item);
                      }}
                      className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm font-medium text-neutral-800 hover:bg-neutral-100"
                    >
                      <ExternalLink className="size-4 text-neutral-500" aria-hidden />
                      <span className="truncate">{t('library.viewer.openExternal')}</span>
                    </button>

                    {canManage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onEdit(item);
                          }}
                          className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm font-medium text-neutral-800 hover:bg-neutral-100"
                        >
                          <Pencil className="size-4 text-neutral-500" aria-hidden />
                          <span className="truncate">{t('library.actions.edit')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onRequestDeleteOrHide(item);
                          }}
                          className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-start text-sm font-medium text-danger-600 hover:bg-danger-50"
                        >
                          {item.builtIn ? (
                            <>
                              <EyeOff className="size-4" aria-hidden />
                              <span className="truncate">{t('library.actions.hideBuiltIn')}</span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="size-4" aria-hidden />
                              <span className="truncate">{t('library.actions.delete')}</span>
                            </>
                          )}
                        </button>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Clean Unboxed Metadata Row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 tabular-nums">
          {typeof item.pages === 'number' && item.pages > 0 ? (
            <>
              <span>{t('library.meta.pages', { count: item.pages })}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{formatFileSize(item.size, i18n.language)}</span>
          {item.lastOpenedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {t('library.meta.lastOpened', {
                  date: formatShortDate(item.lastOpenedAt, i18n.language),
                })}
              </span>
            </>
          ) : null}
          {viewerKind === 'pdf' && item.lastPage > 1 && item.pages ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-primary-700">
                {t('library.meta.resumePage', { page: item.lastPage, total: item.pages })}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
