export type OfflineShellResult = {
  cachedRoutes: number;
  cachedAssets: number;
  templateCached: boolean;
};

export async function prepareOfflineShell(): Promise<OfflineShellResult> {
  if (!('serviceWorker' in navigator)) throw new Error('Offline installation is not supported by this browser.');
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) throw new Error('The offline app worker is not active yet. Reload and try again.');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('Preparing offline pages timed out. Check your connection and try again.'));
    }, 60_000);
    channel.port1.onmessage = (event: MessageEvent) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      const result = event.data;
      if (result?.type === 'PREPARE_OFFLINE_RESULT' && result.templateCached) {
        resolve({ cachedRoutes: result.cachedRoutes, cachedAssets: result.cachedAssets, templateCached: true });
      } else {
        reject(new Error(result?.message ?? 'Offline pages could not be prepared.'));
      }
    };
    worker.postMessage({ type: 'PREPARE_OFFLINE' }, [channel.port2]);
  });
}
