import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeApp } from '@/utils/platform';

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isNativeApp) {
    await shareNativeFile(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeNativeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || `edutrack-${Date.now()}.bin`;
}

async function shareNativeFile(blob: Blob, filename: string): Promise<void> {
  const safePath = sanitizeNativeFilename(filename);
  const base64Data = await blobToBase64(blob);
  let uri: string;
  try {
    const written = await Filesystem.writeFile({
      path: safePath,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    uri = written.uri;
  } catch {
    const fallback = await Filesystem.writeFile({
      path: safePath,
      data: base64Data,
      directory: Directory.Data,
      recursive: true,
    });
    uri = fallback.uri;
  }
  await Share.share({ title: filename, files: [uri], dialogTitle: filename });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
