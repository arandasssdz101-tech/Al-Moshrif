import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  FilePlus2,
  HardDrive,
  RotateCcw,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { FilterChip } from '@/components/ui/FilterChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import { UndoToast } from '@/components/ui/UndoToast';
import {
  addLibraryFile,
  deleteLibraryItem,
  getLibraryFileBlob,
  getLibraryStorageStats,
  hideBuiltInDocument,
  listLibraryMeta,
  requestPersistentStorage,
  restoreBuiltInDocuments,
  restoreDeletedLibraryItem,
  updateLibraryMeta,
  type DeletedLibrarySnapshot,
  type LibraryStorageStats,
} from '@/db/library';
import { LIBRARY_CATEGORIES, type LibraryCategory, type LibraryMeta } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { downloadBlob } from '@/utils/download';
import { errorKey } from '@/utils/errors';
import {
  canManageLibrary,
  classifyViewerKind,
  countHiddenBuiltIns,
  filterAndSortLibraryItems,
  formatFileSize,
  LIBRARY_UNDO_MS,
  validateLibraryFileSize,
  type LibraryCategoryFilter,
  type LibrarySortMode,
} from '@/utils/libraryHelpers';
import { EditLibraryItemModal } from './EditLibraryItemModal';
import { ImageViewerModal } from './ImageViewerModal';
import { LibraryCard } from './LibraryCard';
import { generateImageThumbnail, renderPdfFirstPageThumbnail } from './pdfEngine';
import { PdfViewerModal } from './PdfViewerModal';

interface NoticeBanner {
  tone: 'error' | 'info' | 'success';
  message: string;
  actionItem?: LibraryMeta;
}

export function LibraryScreen() {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const canManage = canManageLibrary(user.role, institution);

  const [items, setItems] = useState<LibraryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storage, setStorage] = useState<LibraryStorageStats | null>(null);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategoryFilter>('all');
  const [sortBy, setSortBy] = useState<LibrarySortMode>('recent');

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<NoticeBanner | null>(null);

  const [activeViewerItem, setActiveViewerItem] = useState<LibraryMeta | null>(null);
  const [editingItem, setEditingItem] = useState<LibraryMeta | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<LibraryMeta | null>(null);
  const [mutating, setMutating] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<DeletedLibrarySnapshot | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const [metaList, stats] = await Promise.all([
        listLibraryMeta(),
        getLibraryStorageStats(),
      ]);
      setItems(metaList);
      setStorage(stats);
      setLoadError(null);
    } catch (error) {
      setLoadError(t(errorKey(error)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void requestPersistentStorage();
    void refreshData();
  }, [refreshData]);

  const hiddenBuiltInCount = useMemo(() => countHiddenBuiltIns(items), [items]);

  const visibleItems = useMemo(
    () => filterAndSortLibraryItems(items, { query, category, sortBy }),
    [category, items, query, sortBy],
  );

  const handleFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManage) return;

    setNotice(null);

    const sizeValidation = validateLibraryFileSize(file.size);
    if (!sizeValidation.ok) {
      setNotice({ tone: 'error', message: t(sizeValidation.errorKey) });
      return;
    }

    setAdding(true);
    try {
      const kind = classifyViewerKind(file.type, file.name);
      let pages: number | null = null;
      let thumbnail: string | null = null;

      if (kind === 'pdf') {
        const buffer = await file.arrayBuffer();
        const preview = await renderPdfFirstPageThumbnail(new Uint8Array(buffer));
        if (preview) {
          pages = preview.numPages;
          thumbnail = preview.dataUrl;
        }
      } else if (kind === 'image') {
        thumbnail = await generateImageThumbnail(file);
      }

      const defaultCategory: LibraryCategory =
        category !== 'all' && category !== 'favorites' ? category : 'other';

      const result = await addLibraryFile(file, {
        category: defaultCategory,
        pages,
        thumbnail,
      });

      await refreshData();

      if (result.status === 'duplicate') {
        setNotice({
          tone: 'info',
          message: t('library.notices.duplicateFound', { title: result.meta.title }),
          actionItem: result.meta,
        });
      } else {
        setNotice({
          tone: 'success',
          message: t('library.notices.added', { title: result.meta.title }),
          actionItem: result.meta,
        });
      }
    } catch (error) {
      setNotice({ tone: 'error', message: t(errorKey(error)) });
    } finally {
      setAdding(false);
    }
  };

  const handleOpenExternal = useCallback(
    async (item: LibraryMeta) => {
      try {
        const blob = await getLibraryFileBlob(item);
        const now = new Date().toISOString();
        const updated = await updateLibraryMeta(item.id, { lastOpenedAt: now });
        if (updated) {
          setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)));
        }
        await downloadBlob(blob, item.fileName || item.title);
      } catch (error) {
        setNotice({ tone: 'error', message: t(errorKey(error)) });
      }
    },
    [t],
  );

  const handleOpenItem = useCallback(
    async (item: LibraryMeta) => {
      setNotice(null);
      const kind = classifyViewerKind(item.mime, item.fileName);
      if (kind === 'external') {
        await handleOpenExternal(item);
        return;
      }

      const now = new Date().toISOString();
      const updated = (await updateLibraryMeta(item.id, { lastOpenedAt: now })) ?? {
        ...item,
        lastOpenedAt: now,
      };
      setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)));
      setActiveViewerItem(updated);
    },
    [handleOpenExternal],
  );

  const handleToggleFavorite = useCallback(async (item: LibraryMeta) => {
    const nextFavorite = !item.favorite;
    const updated = await updateLibraryMeta(item.id, { favorite: nextFavorite });
    if (updated) {
      setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)));
      setActiveViewerItem((prev) => (prev && prev.id === item.id ? updated : prev));
    }
  }, []);

  const handleSaveProgress = useCallback(
    (id: string, lastPage: number, lastZoom: number, totalPages?: number) => {
      void updateLibraryMeta(id, {
        lastPage,
        lastZoom,
        ...(totalPages && totalPages > 0 ? { pages: totalPages } : {}),
      }).then((updated) => {
        if (!updated) return;
        setItems((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
      });
    },
    [],
  );

  const handleSaveImageZoom = useCallback((id: string, lastZoom: number) => {
    void updateLibraryMeta(id, { lastZoom }).then((updated) => {
      if (!updated) return;
      setItems((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
    });
  }, []);

  const handleThumbnailReady = useCallback(
    (id: string, thumbnail: string, pages?: number | null) => {
      void updateLibraryMeta(id, {
        thumbnail,
        ...(typeof pages === 'number' && pages > 0 ? { pages } : {}),
      }).then((updated) => {
        if (!updated) return;
        setItems((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
      });
    },
    [],
  );

  const handleEditSave = async (id: string, title: string, nextCategory: LibraryCategory) => {
    setMutating(true);
    try {
      const updated = await updateLibraryMeta(id, { title, category: nextCategory });
      if (updated) {
        setItems((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
      }
      setEditingItem(null);
    } finally {
      setMutating(false);
    }
  };

  const handleConfirmRemoval = async () => {
    if (!pendingRemoval) return;
    setMutating(true);
    try {
      if (pendingRemoval.builtIn) {
        await hideBuiltInDocument(pendingRemoval.id);
        await refreshData();
      } else {
        const snapshot = await deleteLibraryItem(pendingRemoval.id);
        await refreshData();
        if (snapshot) {
          setUndoSnapshot(snapshot);
        }
      }
      setPendingRemoval(null);
    } catch (error) {
      setNotice({ tone: 'error', message: t(errorKey(error)) });
    } finally {
      setMutating(false);
    }
  };

  const handleUndoDelete = () => {
    if (!undoSnapshot) return;
    const toRestore = undoSnapshot;
    setUndoSnapshot(null);
    void restoreDeletedLibraryItem(toRestore).then(() => refreshData());
  };

  const handleRestoreBuiltIns = async () => {
    setMutating(true);
    try {
      await restoreBuiltInDocuments();
      await refreshData();
      setNotice({ tone: 'success', message: t('library.notices.builtInsRestored') });
    } finally {
      setMutating(false);
    }
  };

  if (loading) return <LoadingState />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void refreshData()} />;

  const activeViewerKind = activeViewerItem
    ? classifyViewerKind(activeViewerItem.mime, activeViewerItem.fileName)
    : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Header + Storage + Primary Add Action */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl text-neutral-900">{t('library.title')}</h1>
          <p className="text-sm text-neutral-600">{t('library.subtitle')}</p>
          {storage ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500 tabular-nums">
              <HardDrive className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
              <span>
                {t('library.storageUsed', {
                  used: formatFileSize(storage.libraryBytes, i18n.language),
                })}
              </span>
              {storage.quotaBytes ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t('library.storageQuota', {
                      total: formatFileSize(storage.quotaBytes, i18n.language),
                    })}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && hiddenBuiltInCount > 0 ? (
            <Button
              variant="secondary"
              disabled={mutating}
              onClick={() => void handleRestoreBuiltIns()}
              icon={<RotateCcw className="size-4" aria-hidden />}
            >
              {t('library.restoreBuiltIns')}
            </Button>
          ) : null}

          {canManage ? (
            <label
              className={`relative inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 active:scale-[0.98] ${
                adding ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <FilePlus2 className="size-5 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">
                {adding ? t('library.addingFile') : t('library.addFile')}
              </span>
              <input
                type="file"
                disabled={adding}
                onChange={handleFilePick}
                aria-label={t('library.addFile')}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          ) : null}
        </div>
      </header>

      {/* Notice / Error Banner */}
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-2xl p-3.5 text-sm ring-1 ${
            notice.tone === 'error'
              ? 'bg-danger-50 text-danger-700 ring-danger-200'
              : notice.tone === 'success'
                ? 'bg-success-50 text-success-700 ring-success-200'
                : 'bg-primary-50 text-primary-700 ring-primary-200'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="font-medium">{notice.message}</p>
              {notice.actionItem ? (
                <div>
                  <button
                    type="button"
                    onClick={() => void handleOpenItem(notice.actionItem!)}
                    className="text-xs font-bold underline underline-offset-2"
                  >
                    {t('library.actions.openNow')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t('common.close')}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-black/5"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Search + Sort Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('library.searchPlaceholder')}
            aria-label={t('library.searchPlaceholder')}
            className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white pe-10 ps-11 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('common.clear')}
              className="absolute end-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <label className="flex shrink-0 items-center gap-2">
          <span className="sr-only">{t('library.sort.label')}</span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as LibrarySortMode)}
            aria-label={t('library.sort.label')}
            className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3.5 text-sm font-medium text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 sm:w-auto"
          >
            <option value="recent">{t('library.sort.recent')}</option>
            <option value="title">{t('library.sort.title')}</option>
            <option value="dateAdded">{t('library.sort.dateAdded')}</option>
          </select>
        </label>
      </div>

      {/* Scrollable Category Filter Chips */}
      <div
        role="group"
        aria-label={t('library.categoriesLabel')}
        className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <FilterChip
          label={t('library.categories.all')}
          active={category === 'all'}
          onClick={() => setCategory('all')}
        />
        <FilterChip
          label={
            <span className="inline-flex items-center gap-1.5">
              <Star className="size-3.5" aria-hidden />
              {t('library.categories.favorites')}
            </span>
          }
          active={category === 'favorites'}
          onClick={() => setCategory('favorites')}
        />
        {LIBRARY_CATEGORIES.map((cat) => (
          <FilterChip
            key={cat}
            label={t(`library.categories.${cat}`)}
            active={category === cat}
            onClick={() => setCategory(cat)}
          />
        ))}
      </div>

      {/* Document Cards Grid or Empty State */}
      {visibleItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-full">
            <EmptyState
              icon={<BookOpen className="size-7" aria-hidden />}
              title={
                query || category !== 'all'
                  ? t('library.emptyFilteredTitle')
                  : t('library.emptyTitle')
              }
              body={
                query || category !== 'all'
                  ? t('library.emptyFilteredBody')
                  : t('library.emptyBody')
              }
            />
          </div>
          {query || category !== 'all' ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setCategory('all');
              }}
            >
              {t('library.clearFilters')}
            </Button>
          ) : canManage && hiddenBuiltInCount > 0 ? (
            <Button variant="secondary" onClick={() => void handleRestoreBuiltIns()}>
              {t('library.restoreBuiltIns')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleItems.map((item) => (
            <LibraryCard
              key={item.id}
              item={item}
              canManage={canManage}
              onOpen={(doc) => void handleOpenItem(doc)}
              onOpenExternal={(doc) => void handleOpenExternal(doc)}
              onToggleFavorite={(doc) => void handleToggleFavorite(doc)}
              onEdit={setEditingItem}
              onRequestDeleteOrHide={setPendingRemoval}
              onThumbnailReady={handleThumbnailReady}
            />
          ))}
        </div>
      )}

      {/* Rename / Category Modal */}
      <EditLibraryItemModal
        item={editingItem}
        busy={mutating}
        onClose={() => setEditingItem(null)}
        onSave={(id, title, cat) => void handleEditSave(id, title, cat)}
      />

      {/* Delete / Hide Confirmation Modal */}
      <ConfirmModal
        open={pendingRemoval !== null}
        title={
          pendingRemoval?.builtIn
            ? t('library.confirmHide.title')
            : t('library.confirmDelete.title')
        }
        body={
          pendingRemoval?.builtIn
            ? t('library.confirmHide.body', { title: pendingRemoval.title })
            : t('library.confirmDelete.body', { title: pendingRemoval?.title ?? '' })
        }
        confirmLabel={
          pendingRemoval?.builtIn
            ? t('library.actions.hideBuiltIn')
            : t('library.actions.delete')
        }
        busy={mutating}
        onConfirm={() => void handleConfirmRemoval()}
        onCancel={() => setPendingRemoval(null)}
      />

      {/* 8-Second Undo Toast after deleting a user file */}
      {undoSnapshot ? (
        <UndoToast
          key={undoSnapshot.meta.id}
          message={t('library.notices.deleted', { title: undoSnapshot.meta.title })}
          durationMs={LIBRARY_UNDO_MS}
          onUndo={handleUndoDelete}
          onExpire={() => setUndoSnapshot(null)}
        />
      ) : null}

      {/* Full-Screen PDF Viewer */}
      {activeViewerItem && activeViewerKind === 'pdf' ? (
        <PdfViewerModal
          item={activeViewerItem}
          onClose={() => setActiveViewerItem(null)}
          onSaveProgress={handleSaveProgress}
          onToggleFavorite={(doc) => void handleToggleFavorite(doc)}
        />
      ) : null}

      {/* Full-Screen Image Viewer */}
      {activeViewerItem && activeViewerKind === 'image' ? (
        <ImageViewerModal
          item={activeViewerItem}
          onClose={() => setActiveViewerItem(null)}
          onSaveZoom={handleSaveImageZoom}
          onToggleFavorite={(doc) => void handleToggleFavorite(doc)}
        />
      ) : null}
    </div>
  );
}
