export type PreparedReportPhoto = { blob: Blob; width: number; height: number };

export async function prepareReportPhoto(blob: Blob): Promise<PreparedReportPhoto> {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot prepare photos for the Word report.');
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo could not be prepared for the Word report.');
    context.drawImage(bitmap, 0, 0, width, height);
    const prepared = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!prepared) throw new Error('Photo could not be encoded for the Word report.');
    return { blob: prepared, width, height };
  } finally {
    bitmap.close();
  }
}
