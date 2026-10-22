export function inspectionHref(inspectionId: string, options: { catalogId?: string; view?: boolean; offline?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (options.offline) query.set('inspectionId', inspectionId);
  if (options.catalogId) query.set('catalogId', options.catalogId);
  if (options.view) query.set('view', '1');
  const path = options.offline ? '/inspect/work' : `/inspect/${encodeURIComponent(inspectionId)}`;
  return `${path}${query.size ? `?${query}` : ''}`;
}

export function navigateToInspectionOffline(inspectionId: string, options: { catalogId?: string; view?: boolean } = {}): boolean {
  if (typeof navigator === 'undefined' || navigator.onLine) return false;
  window.location.assign(inspectionHref(inspectionId, { ...options, offline: true }));
  return true;
}
