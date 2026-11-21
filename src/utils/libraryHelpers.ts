import type {
  Institution,
  LibraryCategory,
  LibraryFile,
  LibraryMeta,
  UserRole,
} from '@/db/types';

export const MAX_LIBRARY_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
export const LIBRARY_UNDO_MS = 8000;

export type LibraryCategoryFilter = 'all' | 'favorites' | LibraryCategory;
export type LibrarySortMode = 'recent' | 'title' | 'dateAdded';
export type LibraryViewerKind = 'pdf' | 'image' | 'external';

export interface BuiltInDocumentDef {
  id: string;
  title: string;
  category: LibraryCategory;
  pages: number;
  size: number;
  fileName: string;
  assetPath: string;
  mime: string;
  addedAt: string;
}

/**
 * Built-in offline documents bundled in public/library/ with strictly ASCII filenames.
 * Arabic titles and categories live in code metadata.
 */
export const BUILTIN_LIBRARY_DOCUMENTS: readonly BuiltInDocumentDef[] = [
  {
    id: 'builtin-field-guide-educational-duty',
    title: 'الدليل الميداني للمداومة التربوية وتنشيط القسم (التعليم المتوسط)',
    category: 'guides',
    pages: 5,
    size: 535342,
    fileName: 'field-guide-educational-duty.pdf',
    assetPath: './library/field-guide-educational-duty.pdf',
    mime: 'application/pdf',
    addedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'builtin-law-08-04',
    title: 'القانون التوجيهي للتربية الوطنية (قانون رقم 08-04 المؤرخ في 23 يناير 2008)',
    category: 'laws',
    pages: 10,
    size: 554937,
    fileName: 'law-08-04.pdf',
    assetPath: './library/law-08-04.pdf',
    mime: 'application/pdf',
    addedAt: '2026-01-01T00:00:01.000Z',
  },
] as const;

export function createBuiltInMeta(def: BuiltInDocumentDef): LibraryMeta {
  return {
    id: def.id,
    title: def.title,
    category: def.category,
    pages: def.pages,
    size: def.size,
    addedAt: def.addedAt,
    lastOpenedAt: null,
    favorite: false,
    builtIn: true,
    hidden: false,
    lastPage: 1,
    lastZoom: 1,
    mime: def.mime,
    fileName: def.fileName,
    assetPath: def.assetPath,
    thumbnail: null,
  };
}

export function canManageLibrary(
  role: UserRole,
  institution: Pick<Institution, 'librarySupervisorsCanManage'>,
): boolean {
  if (role === 'head') return true;
  return institution.librarySupervisorsCanManage === true;
}

export type FileSizeValidationResult =
  | { ok: true }
  | { ok: false; errorKey: 'library.errors.emptyFile' | 'library.errors.fileTooLarge' };

export function validateLibraryFileSize(
  size: number,
  maxBytes: number = MAX_LIBRARY_FILE_BYTES,
): FileSizeValidationResult {
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, errorKey: 'library.errors.emptyFile' };
  }
  if (size > maxBytes) {
    return { ok: false, errorKey: 'library.errors.fileTooLarge' };
  }
  return { ok: true };
}

/**
 * Generates a clean display title from a file name:
 * strips the file extension, turns underscores into spaces, and collapses extra spaces.
 */
export function deriveTitleFromFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return 'Untitled';
  const baseName = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const dotIndex = baseName.lastIndexOf('.');
  const withoutExt = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const cleaned = withoutExt.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || baseName;
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};

export function getFileExtension(fileName: string): string {
  const baseName = fileName.trim().split(/[\\/]/).pop() ?? '';
  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === baseName.length - 1) return '';
  return baseName.slice(dotIndex + 1).toLowerCase();
}

export function inferMimeType(fileName: string, providedMime?: string): string {
  const normalized = providedMime?.trim().toLowerCase();
  if (normalized && normalized !== 'application/octet-stream') {
    return normalized;
  }
  const ext = getFileExtension(fileName);
  return EXTENSION_MIME_MAP[ext] ?? normalized ?? 'application/octet-stream';
}

export function classifyViewerKind(mime: string, fileName = ''): LibraryViewerKind {
  const normalized = mime.toLowerCase();
  const ext = getFileExtension(fileName);
  if (normalized === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    normalized === 'image/jpeg' ||
    normalized === 'image/png' ||
    normalized === 'image/webp' ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'png' ||
    ext === 'webp'
  ) {
    return 'image';
  }
  return 'external';
}

export function formatFileSize(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const isAr = locale.startsWith('ar');
  if (bytes < 1024) {
    return `${Math.round(bytes)} ${isAr ? 'بايت' : 'B'}`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} ${isAr ? 'ك.ب' : 'KB'}`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${isAr ? 'م.ب' : 'MB'}`;
}

/**
 * Pure-JS SHA-256 fallback for environments where crypto.subtle is unavailable
 * (e.g., insecure HTTP contexts or older Android WebViews).
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Fallback(data: Uint8Array): string {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeSha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Fallback(bytes);
}

export function findDuplicateFileIdByHash(
  files: readonly Pick<LibraryFile, 'id' | 'hash'>[],
  hash: string,
): string | null {
  const normalized = hash.trim().toLowerCase();
  if (!normalized) return null;
  const match = files.find((item) => item.hash.toLowerCase() === normalized);
  return match ? match.id : null;
}

export function mergeBuiltInMeta(
  existing: readonly LibraryMeta[],
  defs: readonly BuiltInDocumentDef[] = BUILTIN_LIBRARY_DOCUMENTS,
): { merged: LibraryMeta[]; added: LibraryMeta[] } {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const added: LibraryMeta[] = [];
  for (const def of defs) {
    if (!existingById.has(def.id)) {
      const created = createBuiltInMeta(def);
      existingById.set(def.id, created);
      added.push(created);
    }
  }
  return {
    merged: Array.from(existingById.values()),
    added,
  };
}

export function hideBuiltInInList(items: readonly LibraryMeta[], id: string): LibraryMeta[] {
  return items.map((item) =>
    item.id === id && item.builtIn ? { ...item, hidden: true } : item,
  );
}

export function restoreBuiltInsInList(
  items: readonly LibraryMeta[],
  defs: readonly BuiltInDocumentDef[] = BUILTIN_LIBRARY_DOCUMENTS,
): LibraryMeta[] {
  const { merged } = mergeBuiltInMeta(items, defs);
  return merged.map((item) => (item.builtIn ? { ...item, hidden: false } : item));
}

export function countHiddenBuiltIns(items: readonly LibraryMeta[]): number {
  return items.filter((item) => item.builtIn && item.hidden).length;
}

export interface FilterSortOptions {
  query: string;
  category: LibraryCategoryFilter;
  sortBy: LibrarySortMode;
}

export function filterAndSortLibraryItems(
  items: readonly LibraryMeta[],
  options: FilterSortOptions,
): LibraryMeta[] {
  const q = options.query.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (item.hidden) return false;
    if (options.category === 'favorites' && !item.favorite) return false;
    if (
      options.category !== 'all' &&
      options.category !== 'favorites' &&
      item.category !== options.category
    ) {
      return false;
    }
    if (q && !item.title.toLowerCase().includes(q) && !item.fileName.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    // Built-in documents always appear first.
    if (a.builtIn !== b.builtIn) {
      return a.builtIn ? -1 : 1;
    }

    if (options.sortBy === 'title') {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }

    if (options.sortBy === 'dateAdded') {
      return b.addedAt.localeCompare(a.addedAt);
    }

    // Default: 'recent' (most recently opened first, falling back to addedAt)
    const aRecent = a.lastOpenedAt ?? a.addedAt;
    const bRecent = b.lastOpenedAt ?? b.addedAt;
    return bRecent.localeCompare(aRecent);
  });
}
