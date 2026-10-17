'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudUpload, FileCheck2 } from 'lucide-react';
import { syncMasterlistCatalog } from '@/features/catalog/catalog-sync';
import { publishMasterlist, type CatalogPublishResult } from '@/features/catalog/catalog-publish-client';
import { inspectMasterlistFile, type MasterlistInspection } from '@/features/catalog/catalog-publish-validation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { InlineNotice, Surface } from '@/components/ui';

type PanelState = 'idle' | 'inspecting' | 'review' | 'uploading' | 'success' | 'error';

export function CatalogManagementPanel({ onPublished }: { onPublished?: (result: CatalogPublishResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<PanelState>('idle');
  const [inspection, setInspection] = useState<MasterlistInspection | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CatalogPublishResult | null>(null);
  const [currentManifest, setCurrentManifest] = useState<CatalogPublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: manifestError } = await getSupabaseBrowserClient()
          .from('catalog_manifests')
          .select('version, row_count, integrity_hash, storage_path, published_at, catalog_role')
          .eq('catalog_role', 'masterlist')
          .maybeSingle();
        if (active && !manifestError && data) {
          setCurrentManifest({
            catalogRole: 'masterlist',
            version: data.version,
            rowCount: data.row_count,
            integrityHash: data.integrity_hash,
            storagePath: data.storage_path,
            publishedAt: data.published_at,
          });
        }
      } catch {
        // Publishing remains available if the current manifest cannot be read.
      }
    })();
    return () => { active = false; };
  }, []);

  const selectFile = async (selected: File | undefined) => {
    if (!selected) return;
    setState('inspecting');
    setError(null);
    setResult(null);
    try {
      const nextInspection = await inspectMasterlistFile(selected);
      setFile(selected);
      setInspection(nextInspection);
      setState('review');
    } catch (inspectionError) {
      setInspection(null);
      setFile(null);
      setState('error');
      setError(inspectionError instanceof Error ? inspectionError.message : 'The masterlist could not be inspected.');
    }
  };

  const publish = async () => {
    if (!file || !inspection) return;
    setState('uploading');
    setError(null);
    try {
      const published = await publishMasterlist(file, inspection);
      await syncMasterlistCatalog();
      setResult(published);
      setCurrentManifest(published);
      setState('success');
      onPublished?.(published);
    } catch (publishError) {
      setState('error');
      setError(publishError instanceof Error ? publishError.message : 'The masterlist could not be published.');
    }
  };

  return (
    <Surface component="section" aria-labelledby="catalog-management-title" className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 id="catalog-management-title" className="text-lg font-semibold text-ink">Catalog management</h2>
          <p className="text-sm text-muted">
            Upload a validated masterlist for personnel accounts to receive during their next sync.
          </p>
        </div>

        {currentManifest && (
          <div className="flex flex-col gap-1 text-sm text-ink sm:flex-row sm:gap-6"><p><strong>Current version:</strong> {currentManifest.version}</p><p><strong>Products:</strong> {currentManifest.rowCount.toLocaleString()}</p><p><strong>Published:</strong> {new Date(currentManifest.publishedAt).toLocaleString()}</p></div>
        )}

        {state === 'success' && result && (
          <InlineNotice severity="success">
            Masterlist version {result.version} published with {result.rowCount.toLocaleString()} products. This browser has refreshed its local catalog.
          </InlineNotice>
        )}
        {error && <InlineNotice severity="error">{error}</InlineNotice>}
        {state === 'uploading' && <div role="progressbar" aria-label="Publishing masterlist" className="h-1.5 overflow-hidden rounded-full bg-primary-soft"><div className="h-full w-1/2 animate-pulse bg-primary" /></div>}

        {inspection && (state === 'review' || state === 'uploading' || state === 'success') && (
          <div className="space-y-1 rounded-lg bg-surface-alt p-4">
            <h3 className="text-sm font-semibold text-ink">Review before publishing</h3>
            <p className="text-sm text-muted">{inspection.fileName} · {(inspection.sizeBytes / 1024 / 1024).toFixed(1)} MiB</p>
            <p className="text-sm text-muted">{inspection.rowCount.toLocaleString()} products · schema {inspection.schemaVersion}</p>
            <p className="text-sm text-muted">Product types: {inspection.productTypes.join(', ')}</p>
            <p className="text-sm text-muted">
              Categories: {Object.entries(inspection.categoryCounts ?? {}).map(([name, count]) => `${name} (${count.toLocaleString()})`).join(' · ')}
            </p>
            <p className="text-sm text-warning">
              Publishing overwrites the current masterlist for future catalog syncs. Existing local inspections are preserved.
            </p>
            {currentManifest && <p className="text-sm text-muted">Current version {currentManifest.version} ({currentManifest.rowCount.toLocaleString()} products) → incoming catalog</p>}
            <p className="break-all font-mono text-xs text-muted">
              SHA-256: {inspection.sha256}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row"><button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary disabled:opacity-50" onClick={() => inputRef.current?.click()} disabled={state === 'inspecting' || state === 'uploading'}><CloudUpload aria-hidden="true" className="size-4" />Choose masterlist.json</button><button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-50" onClick={() => void publish()} disabled={!inspection || !file || state !== 'review'}><FileCheck2 aria-hidden="true" className="size-4" />Publish masterlist</button></div>
        <input
          ref={inputRef}
          hidden
          type="file"
          aria-label="Choose masterlist.json file"
          accept="application/json,.json"
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        {result && state === 'success' && <span className="inline-flex rounded-full border border-success px-3 py-1 text-xs font-semibold text-success">Published {new Date(result.publishedAt).toLocaleString()}</span>}
    </Surface>
  );
}
