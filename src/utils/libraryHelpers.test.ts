import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LIBRARY_DOCUMENTS,
  MAX_LIBRARY_FILE_BYTES,
  canManageLibrary,
  classifyViewerKind,
  computeSha256Hex,
  countHiddenBuiltIns,
  createBuiltInMeta,
  deriveTitleFromFileName,
  filterAndSortLibraryItems,
  findDuplicateFileIdByHash,
  formatFileSize,
  hideBuiltInInList,
  mergeBuiltInMeta,
  restoreBuiltInsInList,
  validateLibraryFileSize,
} from '@/utils/libraryHelpers';
import { parseBackup } from '@/db/backup';
import type { LibraryMeta } from '@/db/types';

describe('library built-in metadata', () => {
  it('defines both required built-in PDFs with exact Arabic titles, categories, pages, and ASCII filenames', () => {
    expect(BUILTIN_LIBRARY_DOCUMENTS).toHaveLength(2);

    const [guide, law] = BUILTIN_LIBRARY_DOCUMENTS;
    expect(guide.title).toBe('الدليل الميداني للمداومة التربوية وتنشيط القسم (التعليم المتوسط)');
    expect(guide.category).toBe('guides');
    expect(guide.pages).toBe(5);
    expect(guide.fileName).toBe('field-guide-educational-duty.pdf');
    expect(guide.assetPath).toBe('./library/field-guide-educational-duty.pdf');

    expect(law.title).toBe('القانون التوجيهي للتربية الوطنية (قانون رقم 08-04 المؤرخ في 23 يناير 2008)');
    expect(law.category).toBe('laws');
    expect(law.pages).toBe(10);
    expect(law.fileName).toBe('law-08-04.pdf');
    expect(law.assetPath).toBe('./library/law-08-04.pdf');

    for (const doc of BUILTIN_LIBRARY_DOCUMENTS) {
      expect(/^[\x20-\x7E]+$/.test(doc.fileName)).toBe(true);
      expect(doc.fileName.includes('#U')).toBe(false);
    }
  });

  it('derives clean titles from uploaded filenames by removing extension and underscores', () => {
    expect(deriveTitleFromFileName('ministerial_circular_2026.pdf')).toBe('ministerial circular 2026');
    expect(deriveTitleFromFileName('C:\\docs\\student__report_card.docx')).toBe('student report card');
    expect(deriveTitleFromFileName('schedule.png')).toBe('schedule');
    expect(deriveTitleFromFileName('noext')).toBe('noext');
  });

  it('classifies PDFs, images, and external Office files accurately', () => {
    expect(classifyViewerKind('application/pdf', 'doc.pdf')).toBe('pdf');
    expect(classifyViewerKind('image/jpeg', 'photo.jpg')).toBe('image');
    expect(classifyViewerKind('image/png', 'scan.png')).toBe('image');
    expect(classifyViewerKind('image/webp', 'diagram.webp')).toBe('image');
    expect(
      classifyViewerKind(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'notes.docx',
      ),
    ).toBe('external');
    expect(classifyViewerKind('application/octet-stream', 'sheet.xlsx')).toBe('external');
    expect(classifyViewerKind('application/octet-stream', 'slides.pptx')).toBe('external');
  });
});

describe('library file-size validation', () => {
  it('enforces the 50 MB maximum and rejects empty files', () => {
    expect(MAX_LIBRARY_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(validateLibraryFileSize(0)).toEqual({ ok: false, errorKey: 'library.errors.emptyFile' });
    expect(validateLibraryFileSize(-10)).toEqual({ ok: false, errorKey: 'library.errors.emptyFile' });
    expect(validateLibraryFileSize(1)).toEqual({ ok: true });
    expect(validateLibraryFileSize(MAX_LIBRARY_FILE_BYTES)).toEqual({ ok: true });
    expect(validateLibraryFileSize(MAX_LIBRARY_FILE_BYTES + 1)).toEqual({
      ok: false,
      errorKey: 'library.errors.fileTooLarge',
    });
  });

  it('formats sizes cleanly in English and Arabic', () => {
    expect(formatFileSize(512, 'en')).toBe('512 B');
    expect(formatFileSize(2048, 'en')).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024, 'ar')).toBe('5.0 م.ب');
  });
});

describe('library SHA-256 de-duplication', () => {
  it('produces identical SHA-256 hashes for identical bytes and detects duplicates', async () => {
    const encoder = new TextEncoder();
    const bytesA = encoder.encode('Algerian school library document content');
    const bytesB = encoder.encode('Algerian school library document content');
    const bytesC = encoder.encode('Different document content');

    const hashA = await computeSha256Hex(bytesA);
    const hashB = await computeSha256Hex(bytesB);
    const hashC = await computeSha256Hex(bytesC);

    expect(hashA).toHaveLength(64);
    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);

    const storedFiles = [{ id: 'lib-1', hash: hashA }];
    expect(findDuplicateFileIdByHash(storedFiles, hashB)).toBe('lib-1');
    expect(findDuplicateFileIdByHash(storedFiles, hashC)).toBeNull();
  });
});

describe('library hide and restore of built-in documents', () => {
  it('seeds missing built-ins without overwriting existing user metadata', () => {
    const customGuide: LibraryMeta = {
      ...createBuiltInMeta(BUILTIN_LIBRARY_DOCUMENTS[0]),
      favorite: true,
      lastPage: 4,
      lastZoom: 1.5,
      hidden: true,
    };

    const { merged, added } = mergeBuiltInMeta([customGuide]);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe(BUILTIN_LIBRARY_DOCUMENTS[1].id);
    expect(merged).toHaveLength(2);

    const preserved = merged.find((item) => item.id === customGuide.id);
    expect(preserved?.favorite).toBe(true);
    expect(preserved?.lastPage).toBe(4);
    expect(preserved?.hidden).toBe(true);
  });

  it('hides a built-in document from the list and restores all hidden built-ins', () => {
    const initial = BUILTIN_LIBRARY_DOCUMENTS.map(createBuiltInMeta);
    expect(countHiddenBuiltIns(initial)).toBe(0);

    const afterHide = hideBuiltInInList(initial, BUILTIN_LIBRARY_DOCUMENTS[0].id);
    expect(countHiddenBuiltIns(afterHide)).toBe(1);

    const visibleAfterHide = filterAndSortLibraryItems(afterHide, {
      query: '',
      category: 'all',
      sortBy: 'recent',
    });
    expect(visibleAfterHide).toHaveLength(1);
    expect(visibleAfterHide[0].id).toBe(BUILTIN_LIBRARY_DOCUMENTS[1].id);

    const restored = restoreBuiltInsInList(afterHide);
    expect(countHiddenBuiltIns(restored)).toBe(0);
    expect(
      filterAndSortLibraryItems(restored, { query: '', category: 'all', sortBy: 'recent' }),
    ).toHaveLength(2);
  });
});

describe('library permissions, filtering, sorting, and backup parsing', () => {
  it('allows head supervisor always and regular supervisors only when setting is enabled', () => {
    expect(canManageLibrary('head', { librarySupervisorsCanManage: false })).toBe(true);
    expect(canManageLibrary('supervisor', { librarySupervisorsCanManage: false })).toBe(false);
    expect(canManageLibrary('supervisor', {})).toBe(false);
    expect(canManageLibrary('supervisor', { librarySupervisorsCanManage: true })).toBe(true);
  });

  it('lists built-in documents first and supports search, category, favorites, and sort', () => {
    const builtIns = BUILTIN_LIBRARY_DOCUMENTS.map(createBuiltInMeta);
    const userDoc: LibraryMeta = {
      id: 'lib-user-1',
      title: 'Annual Exam Circular',
      category: 'circulars',
      pages: 3,
      size: 12000,
      addedAt: '2026-11-21T10:00:00.000Z',
      lastOpenedAt: '2026-11-21T12:00:00.000Z',
      favorite: true,
      builtIn: false,
      hidden: false,
      lastPage: 1,
      lastZoom: 1,
      mime: 'application/pdf',
      fileName: 'annual_exam_circular.pdf',
      assetPath: null,
      thumbnail: null,
    };

    const allSorted = filterAndSortLibraryItems([userDoc, ...builtIns], {
      query: '',
      category: 'all',
      sortBy: 'recent',
    });
    expect(allSorted[0].builtIn).toBe(true);
    expect(allSorted[1].builtIn).toBe(true);
    expect(allSorted[2].id).toBe('lib-user-1');

    const favs = filterAndSortLibraryItems([userDoc, ...builtIns], {
      query: '',
      category: 'favorites',
      sortBy: 'recent',
    });
    expect(favs.map((item) => item.id)).toEqual(['lib-user-1']);

    const lawSearch = filterAndSortLibraryItems([userDoc, ...builtIns], {
      query: '08-04',
      category: 'laws',
      sortBy: 'title',
    });
    expect(lawSearch.map((item) => item.id)).toEqual(['builtin-law-08-04']);
  });

  it('keeps library data optional in JSON backups and parses it when included', () => {
    const baseBackup = {
      format: 'school-admin-backup',
      version: 1,
      exportedAt: '2026-11-21T00:00:00.000Z',
      institutions: [{ id: 'inst-1', institutionId: 'inst-1' }],
      users: [{ id: 'user-1', institutionId: 'inst-1' }],
    };

    const withoutLibrary = parseBackup(JSON.stringify(baseBackup));
    expect(withoutLibrary?.libraryMeta).toBeUndefined();
    expect(withoutLibrary?.libraryFiles).toBeUndefined();

    const withLibrary = parseBackup(
      JSON.stringify({
        ...baseBackup,
        libraryMeta: [createBuiltInMeta(BUILTIN_LIBRARY_DOCUMENTS[0])],
        libraryFiles: [
          { id: 'lib-1', mime: 'application/pdf', size: 4, hash: 'abc', dataBase64: 'JVBERg==' },
        ],
      }),
    );
    expect(withLibrary?.libraryMeta).toHaveLength(1);
    expect(withLibrary?.libraryFiles).toHaveLength(1);
  });
});
