'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined';
import { syncMasterlistCatalog } from '@/features/catalog/catalog-sync';
import { publishMasterlist, type CatalogPublishResult } from '@/features/catalog/catalog-publish-client';
import { inspectMasterlistFile, type MasterlistInspection } from '@/features/catalog/catalog-publish-validation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

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
    <Paper component="section" aria-labelledby="catalog-management-title" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography id="catalog-management-title" variant="h6">Catalog management</Typography>
          <Typography variant="body2" color="text.secondary">
            Upload a validated masterlist for enrolled devices to receive during their next sync.
          </Typography>
        </Box>

        {currentManifest && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }}>
            <Typography variant="body2"><strong>Current version:</strong> {currentManifest.version}</Typography>
            <Typography variant="body2"><strong>Products:</strong> {currentManifest.rowCount.toLocaleString()}</Typography>
            <Typography variant="body2"><strong>Published:</strong> {new Date(currentManifest.publishedAt).toLocaleString()}</Typography>
          </Stack>
        )}

        {state === 'success' && result && (
          <Alert severity="success">
            Masterlist version {result.version} published with {result.rowCount.toLocaleString()} products. This browser has refreshed its local catalog.
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {state === 'uploading' && <LinearProgress aria-label="Publishing masterlist" />}

        {inspection && (state === 'review' || state === 'uploading' || state === 'success') && (
          <Stack spacing={1} sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2">Review before publishing</Typography>
            <Typography variant="body2">{inspection.fileName} · {(inspection.sizeBytes / 1024 / 1024).toFixed(1)} MiB</Typography>
            <Typography variant="body2">{inspection.rowCount.toLocaleString()} products · schema {inspection.schemaVersion}</Typography>
            <Typography variant="body2">Product types: {inspection.productTypes.join(', ')}</Typography>
            <Typography variant="body2">
              Categories: {Object.entries(inspection.categoryCounts ?? {}).map(([name, count]) => `${name} (${count.toLocaleString()})`).join(' · ')}
            </Typography>
            <Typography variant="body2" color="warning.dark">
              Publishing overwrites the current masterlist for future catalog syncs. Existing local inspections are preserved.
            </Typography>
            {currentManifest && <Typography variant="body2">Current version {currentManifest.version} ({currentManifest.rowCount.toLocaleString()} products) → incoming catalog</Typography>}
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              SHA-256: {inspection.sha256}
            </Typography>
          </Stack>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            variant="outlined"
            startIcon={<CloudUploadOutlinedIcon />}
            onClick={() => inputRef.current?.click()}
            disabled={state === 'inspecting' || state === 'uploading'}
          >
            Choose masterlist.json
          </Button>
          <Button
            variant="contained"
            startIcon={<PublishOutlinedIcon />}
            onClick={() => void publish()}
            disabled={!inspection || !file || state !== 'review'}
          >
            Publish masterlist
          </Button>
        </Stack>
        <input
          ref={inputRef}
          hidden
          type="file"
          aria-label="Choose masterlist.json file"
          accept="application/json,.json"
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        {result && state === 'success' && <Chip label={`Published ${new Date(result.publishedAt).toLocaleString()}`} variant="outlined" />}
      </Stack>
    </Paper>
  );
}
