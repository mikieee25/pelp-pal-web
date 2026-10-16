"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  Inventory2Outlined,
  QrCodeScannerRounded,
  SearchRounded,
} from "@mui/icons-material";
import type { CatalogRecord } from "@/lib/db/records";
import { getBrowserRepository } from "@/lib/db/browser";
import { parseScannedValue } from "@/features/lookup/qr-value";
import { QrScannerDialog } from "@/features/lookup/qr-scanner-dialog";
import { hashDoeUrlToken, isCompleteDoeUrl, type OfficialProductRecord } from "@/features/lookup/doe-record";
import { OfficialProductCard } from "@/features/lookup/official-product-card";
import { getEcpType } from "@/features/lookup/catalog-filter";
import { syncMasterlistCatalog } from "@/features/catalog/catalog-sync";
import { CatalogDetails } from "@/features/catalog/catalog-details";
import Link from "next/link";
import { CurrentStorePanel } from "@/features/store/current-store-panel";
import { ListRow, PageHeader, PageShell, Section, Surface } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { designTokens } from "@/theme/tokens";

const CATALOG_RESULT_LIMIT = 10;

export function LookupView() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CatalogRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [ecpTypeFilter, setEcpTypeFilter] = useState("");
  const [ecpTypes, setEcpTypes] = useState<string[]>([]);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState<
    "checking" | "ready" | "error"
  >("checking");
  const [officialRecord, setOfficialRecord] = useState<OfficialProductRecord>();
  const [officialUrl, setOfficialUrl] = useState<string>();
  const [officialLoading, setOfficialLoading] = useState(false);
  const [officialCached, setOfficialCached] = useState(false);
  const [officialSavedAt, setOfficialSavedAt] = useState<string>();
  const [officialError, setOfficialError] = useState<'OFFLINE' | 'UPSTREAM' | 'PARSE_FAILED' | 'RATE_LIMITED'>();
  const visibleRows = ecpTypeFilter
    ? rows.filter((row) => getEcpType(row) === ecpTypeFilter)
    : rows;

  useEffect(() => {
    let active = true;
    void getBrowserRepository()
      .searchCatalog(query, CATALOG_RESULT_LIMIT, ecpTypeFilter)
      .then((nextRows) => {
        if (active) {
          setRows(nextRows);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setRows([]);
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [catalogRefresh, ecpTypeFilter, query]);

  useEffect(() => {
    let active = true;
    void getBrowserRepository()
      .getCatalogEcpTypes()
      .then((types) => {
        if (active) setEcpTypes(types);
      })
      .catch(() => {
        if (active) setEcpTypes([]);
      });
    return () => {
      active = false;
    };
  }, [catalogRefresh]);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => syncMasterlistCatalog())
      .then((result) => {
        if (!active) return;
        setCatalogSyncStatus("ready");
        if (result.status === "updated")
          setCatalogRefresh((current) => current + 1);
      })
      .catch(() => {
        if (active) setCatalogSyncStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const handleQueryChange = useCallback((value: string, clearOfficial = true) => {
    setQuery(value);
    setStatus("loading");
    if (clearOfficial) {
      setOfficialRecord(undefined);
      setOfficialUrl(undefined);
      setOfficialError(undefined);
    }
  }, []);

  useEffect(() => {
    const queryFromUrl = new URLSearchParams(window.location.search).get("query");
    if (!queryFromUrl || queryFromUrl === query) return;
    const timer = window.setTimeout(() => handleQueryChange(queryFromUrl), 0);
    return () => window.clearTimeout(timer);
  }, [handleQueryChange, query]);

  const resolveOfficialRecord = useCallback(async (url: string, refresh = false) => {
    const repository = getBrowserRepository();
    setOfficialUrl(url);
    setOfficialLoading(true);
    setOfficialError(undefined);
    const tokenHash = await hashDoeUrlToken(url);
    const tokenMapping = tokenHash ? await repository.getOfficialProductTokenMap(tokenHash) : undefined;
    const cached = tokenMapping ? await repository.getOfficialProductRecord(tokenMapping.controlNumber) : undefined;
    if (tokenMapping) handleQueryChange(tokenMapping.controlNumber, false);
    if (!navigator.onLine) {
      if (cached) {
        setOfficialRecord({ ...cached.record, imageUrls: [] } as OfficialProductRecord);
        setOfficialCached(true);
        setOfficialSavedAt(cached.fetchedAt);
        handleQueryChange(cached.controlNumber, false);
      } else {
        setOfficialError('OFFLINE');
      }
      setOfficialLoading(false);
      return;
    }
    try {
      const { data, error } = await getSupabaseBrowserClient().functions.invoke('doe-product-lookup', { body: { url, refresh } });
      const response = data as { record?: OfficialProductRecord; cached?: boolean; fetchedAt?: string; error?: string } | null;
      if (error || !response?.record) {
        const errorCode = response?.error ?? await readFunctionErrorCode(error) ?? (error?.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM');
        if (cached) {
          setOfficialRecord({ ...cached.record, imageUrls: [] } as OfficialProductRecord);
          setOfficialCached(true);
          setOfficialSavedAt(cached.fetchedAt);
          handleQueryChange(cached.controlNumber, false);
        } else {
          setOfficialError(errorCode === 'RATE_LIMITED' ? 'RATE_LIMITED' : errorCode === 'PARSE_FAILED' ? 'PARSE_FAILED' : 'UPSTREAM');
        }
        return;
      }
      setOfficialRecord(response.record);
      setOfficialCached(Boolean(response.cached));
      setOfficialSavedAt(response.fetchedAt ?? response.record.fetchedAt);
      await repository.saveOfficialProductRecord(response.record);
      if (tokenHash) await repository.saveOfficialProductTokenMap(tokenHash, response.record.controlNumber);
      handleQueryChange(response.record.controlNumber, false);
    } catch {
      if (cached) {
        setOfficialRecord({ ...cached.record, imageUrls: [] } as OfficialProductRecord);
        setOfficialCached(true);
        setOfficialSavedAt(cached.fetchedAt);
        handleQueryChange(cached.controlNumber, false);
      } else {
        setOfficialError('UPSTREAM');
      }
    } finally {
      setOfficialLoading(false);
    }
  }, [handleQueryChange]);

  const handleQrDetected = useCallback(
    (payload: string) => {
      const scanned = parseScannedValue(payload);
      setIsScannerOpen(false);
      if (scanned.kind === "doe_url") {
        void resolveOfficialRecord(scanned.value);
      } else if (scanned.value) {
        handleQueryChange(scanned.value);
      }
    },
    [handleQueryChange, resolveOfficialRecord]
  );

  const handleLookupInputChange = useCallback((value: string) => {
    if (isCompleteDoeUrl(value)) {
      void resolveOfficialRecord(value.trim());
      return;
    }
    handleQueryChange(value);
  }, [handleQueryChange, resolveOfficialRecord]);

  return (
    <PageShell>
      <Stack spacing={{ xs: 4, md: 5 }}>
      <PageHeader title="Find a product" subtitle="Search the catalog stored on this device before starting an inspection." />

      <CurrentStorePanel returnTo="/lookup" />

      <Surface sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: "action.hover", color: "primary.main" }}>
              <SearchRounded />
            </Avatar>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Search your authorized catalog
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Control number, model, brand, or product type.
              </Typography>
            </Box>
          </Stack>
          <Box component="form" onSubmit={(event) => event.preventDefault()} sx={{ minWidth: 0 }}>
            <TextField
              fullWidth
              label="Search local catalog"
              placeholder="Try a control number, model, or brand"
              value={query}
              onChange={(event) => handleLookupInputChange(event.target.value)}
              autoComplete="off"
              inputProps={{ "aria-label": "Search local catalog" }}
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded color="action" />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <Stack direction="row" alignItems="center" spacing={0.25}>
                      <IconButton aria-label="Clear catalog search" onClick={() => handleQueryChange("")} size="small">
                        <CloseRounded />
                      </IconButton>
                      <IconButton aria-label="Scan QR code" onClick={() => setIsScannerOpen(true)} size="small">
                        <QrCodeScannerRounded />
                      </IconButton>
                    </Stack>
                  </InputAdornment>
                ) : <InputAdornment position="end"><IconButton aria-label="Scan QR code" onClick={() => setIsScannerOpen(true)} size="small"><QrCodeScannerRounded /></IconButton></InputAdornment>,
              }}
            />
          </Box>
          <Stack role="group" aria-label="Product type" direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5, maxWidth: '100%', '&::-webkit-scrollbar': { height: 4 } }}>
            {['', ...ecpTypes].map((type) => <Chip key={type || 'all'} label={type || 'All types'} clickable onClick={() => setEcpTypeFilter(type)} aria-pressed={ecpTypeFilter === type} color={ecpTypeFilter === type ? 'primary' : 'default'} variant={ecpTypeFilter === type ? 'filled' : 'outlined'} sx={{ flexShrink: 0, minHeight: 44, borderRadius: `${designTokens.radius.sm}px`, '& .MuiChip-label': { px: 2 } }} />)}
          </Stack>
        </Stack>
      </Surface>

      {officialLoading && <Alert severity="info">Reading the official DOE record…</Alert>}
      {officialError && <Alert severity={officialError === 'RATE_LIMITED' ? 'warning' : 'info'} action={officialUrl ? <Button component="a" href={officialUrl} target="_blank" rel="noreferrer" size="small">Open on DOE site</Button> : undefined}>{officialError === 'RATE_LIMITED' ? 'The DOE lookup limit was reached. Try again later.' : officialError === 'PARSE_FAILED' ? "Couldn't read this record." : officialError === 'OFFLINE' ? 'This record is not saved on this browser yet. Connect to the internet to look it up.' : "The DOE site isn't reachable right now."}</Alert>}
      {officialRecord && officialUrl && <OfficialProductCard record={officialRecord} cached={officialCached} savedAt={officialSavedAt} loading={officialLoading} onRefresh={officialError === 'RATE_LIMITED' ? undefined : () => void resolveOfficialRecord(officialUrl, true)} />}

      <Section title="Catalog results">
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="body2" color="text.secondary">
              {status === "loading"
                ? "Searching locally…"
                : `${visibleRows.length} ${visibleRows.length === 1 ? "product" : "products"} found on this device`}
            </Typography>
          </Box>
          <Chip
            label={
              catalogSyncStatus === "checking"
                ? "Updating catalog…"
                : catalogSyncStatus === "error"
                  ? "Catalog update unavailable"
                  : "Stored locally"
            }
            color={catalogSyncStatus === "error" ? "warning" : "default"}
            size="small"
            variant="outlined"
          />
        </Stack>

        {status === "loading" ? (
          <Stack spacing={1.5} aria-label="Loading catalog results">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} variant="rounded" height={150} />
            ))}
          </Stack>
        ) : status === "error" ? (
          <Alert severity="error">
            The local catalog could not be read. Refresh to try again.
          </Alert>
        ) : visibleRows.length > 0 ? (
          <Stack component="ul" aria-label="Local catalog results" spacing={2} sx={{ p: 0, m: 0, listStyle: 'none', minWidth: 0 }}>
            {visibleRows.map((row) => <CatalogResult key={row.id} row={row} />)}
          </Stack>
        ) : (
          <Alert severity="info">
            {query
              ? `No products match “${query}”. Try a control number, model, or brand.`
              : ecpTypeFilter
                ? `No ${ecpTypeFilter} products are stored on this browser.`
                : "No catalog products are stored on this browser yet."}
          </Alert>
        )}
      </Stack>
      </Section>

      <QrScannerDialog
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={handleQrDetected}
      />
      </Stack>
    </PageShell>
  );
}

async function readFunctionErrorCode(error: unknown): Promise<string | undefined> {
  if (!error || typeof error !== 'object') return undefined;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof (context as { json?: unknown }).json !== 'function') return undefined;
  try {
    const body = await (context as { json: () => Promise<unknown> }).json();
    return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : undefined;
  } catch {
    return undefined;
  }
}

function CatalogResult({ row }: { row: CatalogRecord }) {
  const brand = firstText(row, ["brand"]);
  const model = firstText(row, ["model_number", "modelNumber", "model"]);
  const controlNumber = firstText(row, [
    "control_number",
    "product_control_number",
    "controlNumber",
  ]);
  const productType = getEcpType(row);
  const title = controlNumber || firstText(row, ["product_name", "name"]) || "Catalog item";
  const catalogLabel =
    row.catalogScope === "guestlist" ? "Guest catalog" : "Master catalog";

  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Surface sx={{ overflow: 'hidden' }}>
        <ListRow
          leading={<Avatar sx={{ bgcolor: 'action.hover', color: 'primary.main', width: 40, height: 40 }}><Inventory2Outlined /></Avatar>}
          primary={<Box component="span" sx={{ fontFamily: designTokens.typography.monoFontFamily, fontSize: `${designTokens.typography.monoSize}px`, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</Box>}
          secondary={[brand, model].filter(Boolean).join(' · ') || 'Catalog item'}
          trailing={<Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5} alignItems={{ xs: 'flex-end', sm: 'center' }}>
            <Typography variant="caption" color="text.secondary">{productType || 'Uncategorized'}</Typography>
            <Chip label={catalogLabel} size="small" variant="outlined" />
            <Button component={Link} href={`/inspect/new?catalogId=${encodeURIComponent(row.id)}`} size="small" variant="outlined">Inspect</Button>
          </Stack>}
        />
      </Surface>
      <Box sx={{ mt: 1 }}><CatalogDetails row={row} /></Box>
    </Box>
  );
}

function firstText(row: CatalogRecord, keys: string[]): string | undefined {
  const value = keys
    .map((key) => row[key])
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : undefined;
}
