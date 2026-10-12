import { parseTransferFile, type TransferBundle } from './transfer-codec';

export type TransferDeliveryResult =
  | { status: 'shared' }
  | { status: 'downloaded' }
  | { status: 'canceled' }
  | { status: 'failed'; message: string };

export function downloadTransferFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name.endsWith('.pelp.json') ? file.name : 'pelp-recovery.pelp.json';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function shareTransferFile(file: File): Promise<TransferDeliveryResult> {
  const canShareFiles = typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [file] })
    && typeof navigator.share === 'function';
  if (!canShareFiles) {
    downloadTransferFile(file);
    return { status: 'downloaded' };
  }
  try {
    await navigator.share({
      files: [file],
      title: 'PELP Pal recovery data',
      text: 'PELP Pal inspection recovery file',
    });
    return { status: 'shared' };
  } catch (error) {
    if (isAbortError(error)) return { status: 'canceled' };
    try {
      downloadTransferFile(file);
      return { status: 'downloaded' };
    } catch (downloadError) {
      return { status: 'failed', message: errorMessage(downloadError) };
    }
  }
}

export function receiveTransferFile(file: File): Promise<TransferBundle> {
  return parseTransferFile(file);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The recovery file could not be downloaded.';
}
