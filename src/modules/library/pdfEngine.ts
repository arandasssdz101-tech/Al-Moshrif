import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

let workerConfigured = false;

export function ensurePdfWorkerConfigured(): void {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerConfigured = true;
}

export function resolvePublicAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  if (typeof window !== 'undefined' && window.location) {
    return new URL(`./${clean}`, window.location.href).href;
  }
  return `./${clean}`;
}

export async function openPdfDocument(
  source: Uint8Array | ArrayBuffer | string,
): Promise<PDFDocumentProxy> {
  ensurePdfWorkerConfigured();

  const commonOptions = {
    cMapUrl: resolvePublicAssetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: resolvePublicAssetUrl('pdfjs/standard_fonts/'),
    useSystemFonts: true,
    isEvalSupported: false,
  };

  const task =
    typeof source === 'string'
      ? pdfjsLib.getDocument({ url: source, ...commonOptions })
      : pdfjsLib.getDocument({
          data: source instanceof Uint8Array ? source : new Uint8Array(source),
          ...commonOptions,
        });

  return task.promise;
}

export interface PdfThumbnailResult {
  dataUrl: string;
  numPages: number;
}

/**
 * Renders page 1 of a PDF into a compact JPEG thumbnail data URL and returns total page count.
 */
export async function destroyPdfDocument(doc: PDFDocumentProxy | null): Promise<void> {
  if (!doc) return;
  try {
    await doc.cleanup();
  } catch {
    // ignore cleanup error
  }
  try {
    await doc.loadingTask.destroy();
  } catch {
    // ignore destroy error
  }
}

export async function renderPdfFirstPageThumbnail(
  source: Uint8Array | ArrayBuffer | string,
  targetWidth = 220,
): Promise<PdfThumbnailResult | null> {
  let doc: PDFDocumentProxy | null = null;
  try {
    doc = await openPdfDocument(source);
    const numPages = doc.numPages;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(0.2, Math.min(2, targetWidth / Math.max(1, baseViewport.width)));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const renderTask = page.render({ canvas, viewport });
    await renderTask.promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;

    return { dataUrl, numPages };
  } catch {
    return null;
  } finally {
    await destroyPdfDocument(doc);
  }
}

/**
 * Creates a lightweight resized JPEG thumbnail data URL for an image Blob.
 */
export async function generateImageThumbnail(
  blob: Blob,
  maxWidth = 260,
): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxWidth / Math.max(1, img.naturalWidth));
        const width = Math.max(1, Math.round(img.naturalWidth * ratio));
        const height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
        } else {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          canvas.width = 0;
          canvas.height = 0;
          resolve(dataUrl);
        }
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
