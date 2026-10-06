const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_DIMENSION = 2_048;

/** Reduce large camera images when the browser provides the bitmap/canvas APIs. */
export async function optimizeEvidenceImage(file: File): Promise<Blob | File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= MAX_EVIDENCE_BYTES && file.type === 'image/jpeg') return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EVIDENCE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return compressed ?? file;
  } finally {
    bitmap.close();
  }
}
