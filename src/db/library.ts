import { db } from './database';
import type { LibraryCategory, LibraryFile, LibraryMeta } from './types';
import {
  BUILTIN_LIBRARY_DOCUMENTS,
  computeSha256Hex,
  createBuiltInMeta,
  deriveTitleFromFileName,
  inferMimeType,
  validateLibraryFileSize,
} from '@/utils/libraryHelpers';
import { DomainError } from '@/utils/errors';

export interface AddLibraryFileResult {
  status: 'added' | 'duplicate';
  meta: LibraryMeta;
}

export interface DeletedLibrarySnapshot {
  meta: LibraryMeta;
  file: LibraryFile | null;
}

export interface LibraryStorageStats {
  libraryBytes: number;
  userFileCount: number;
  quotaBytes: number | null;
  usageBytes: number | null;
  persisted: boolean | null;
}

/**
 * Ensures all built-in documents exist in libraryMeta without overwriting user preferences
 * (favorite, hidden, lastOpenedAt, lastPage, lastZoom, thumbnail).
 */
export async function ensureBuiltInDocuments(): Promise<void> {
  const existingIds = new Set(await db.libraryMeta.toCollection().primaryKeys());
  const missing: LibraryMeta[] = [];
  for (const def of BUILTIN_LIBRARY_DOCUMENTS) {
    if (!existingIds.has(def.id)) {
      missing.push(createBuiltInMeta(def));
    }
  }
  if (missing.length > 0) {
    await db.libraryMeta.bulkPut(missing);
  }
}

export async function listLibraryMeta(): Promise<LibraryMeta[]> {
  await ensureBuiltInDocuments();
  return db.libraryMeta.toArray();
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return null;
    }
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function getLibraryStorageStats(): Promise<LibraryStorageStats> {
  const files = await db.libraryFiles.toArray();
  const libraryBytes = files.reduce((sum, entry) => sum + (entry.size || 0), 0);

  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  let persisted: boolean | null = null;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
        usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
      }
      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
    }
  } catch {
    // Ignore storage estimate errors in restricted WebViews.
  }

  return {
    libraryBytes,
    userFileCount: files.length,
    quotaBytes,
    usageBytes,
    persisted,
  };
}

export async function addLibraryFile(
  file: File,
  options: {
    category?: LibraryCategory;
    pages?: number | null;
    thumbnail?: string | null;
  } = {},
): Promise<AddLibraryFileResult> {
  const sizeCheck = validateLibraryFileSize(file.size);
  if (!sizeCheck.ok) {
    throw new DomainError(sizeCheck.errorKey);
  }

  const buffer = await file.arrayBuffer();
  const hash = await computeSha256Hex(buffer);

  const existingFile = await db.libraryFiles.where('hash').equals(hash).first();
  if (existingFile) {
    const existingMeta = await db.libraryMeta.get(existingFile.id);
    if (existingMeta) {
      if (existingMeta.hidden) {
        const unhidden = { ...existingMeta, hidden: false };
        await db.libraryMeta.put(unhidden);
        return { status: 'duplicate', meta: unhidden };
      }
      return { status: 'duplicate', meta: existingMeta };
    }
    // Orphan blob with no meta: clean it up before inserting fresh record
    await db.libraryFiles.delete(existingFile.id);
  }

  const id = `lib-${crypto.randomUUID()}`;
  const mime = inferMimeType(file.name, file.type);
  const blob = new Blob([buffer], { type: mime });
  const now = new Date().toISOString();

  const meta: LibraryMeta = {
    id,
    title: deriveTitleFromFileName(file.name),
    category: options.category ?? 'other',
    pages: options.pages ?? null,
    size: file.size,
    addedAt: now,
    lastOpenedAt: null,
    favorite: false,
    builtIn: false,
    hidden: false,
    lastPage: 1,
    lastZoom: 1,
    mime,
    fileName: file.name,
    assetPath: null,
    thumbnail: options.thumbnail ?? null,
  };

  const fileRecord: LibraryFile = {
    id,
    blob,
    mime,
    size: file.size,
    hash,
  };

  await db.transaction('rw', [db.libraryMeta, db.libraryFiles], async () => {
    await db.libraryFiles.put(fileRecord);
    await db.libraryMeta.put(meta);
  });

  return { status: 'added', meta };
}

export async function getLibraryFileBlob(meta: LibraryMeta): Promise<Blob> {
  if (meta.builtIn && meta.assetPath) {
    const url = new URL(meta.assetPath, window.location.href).href;
    const response = await fetch(url);
    if (!response.ok) {
      throw new DomainError('library.errors.openFailed');
    }
    const blob = await response.blob();
    return blob.type ? blob : new Blob([blob], { type: meta.mime });
  }

  const stored = await db.libraryFiles.get(meta.id);
  if (!stored) {
    throw new DomainError('library.errors.fileMissing');
  }
  return stored.blob;
}

export async function updateLibraryMeta(
  id: string,
  patch: Partial<
    Pick<
      LibraryMeta,
      'title' | 'category' | 'favorite' | 'lastOpenedAt' | 'lastPage' | 'lastZoom' | 'pages' | 'thumbnail' | 'size'
    >
  >,
): Promise<LibraryMeta | null> {
  const current = await db.libraryMeta.get(id);
  if (!current) return null;
  const next: LibraryMeta = {
    ...current,
    ...patch,
    title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
  };
  await db.libraryMeta.put(next);
  return next;
}

export async function hideBuiltInDocument(id: string): Promise<void> {
  const current = await db.libraryMeta.get(id);
  if (!current || !current.builtIn) return;
  await db.libraryMeta.put({ ...current, hidden: true });
}

export async function restoreBuiltInDocuments(): Promise<void> {
  await ensureBuiltInDocuments();
  const builtIns = await db.libraryMeta.filter((item) => item.builtIn).toArray();
  const updates = builtIns.filter((item) => item.hidden).map((item) => ({ ...item, hidden: false }));
  if (updates.length > 0) {
    await db.libraryMeta.bulkPut(updates);
  }
}

export async function deleteLibraryItem(id: string): Promise<DeletedLibrarySnapshot | null> {
  const meta = await db.libraryMeta.get(id);
  if (!meta || meta.builtIn) return null;
  const file = (await db.libraryFiles.get(id)) ?? null;
  await db.transaction('rw', [db.libraryMeta, db.libraryFiles], async () => {
    await db.libraryMeta.delete(id);
    await db.libraryFiles.delete(id);
  });
  return { meta, file };
}

export async function restoreDeletedLibraryItem(snapshot: DeletedLibrarySnapshot): Promise<void> {
  await db.transaction('rw', [db.libraryMeta, db.libraryFiles], async () => {
    await db.libraryMeta.put(snapshot.meta);
    if (snapshot.file) {
      await db.libraryFiles.put(snapshot.file);
    }
  });
}
