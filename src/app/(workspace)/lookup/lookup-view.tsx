"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { Archive, Camera, Search, X } from 'lucide-react';
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
import { useRouter } from 'next/navigation';
import { CurrentStorePanel } from "@/features/store/current-store-panel";
import { InlineNotice, ListRow, PageHeader, PageShell, Section, Surface } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

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
      <div className="space-y-8">
      <PageHeader title="Find a product" subtitle="Search the catalog stored on this device before starting an inspection." />

      <CurrentStorePanel returnTo="/lookup" />

      <Surface className="p-4 sm:p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><Search aria-hidden="true" /></span><div><h2 className="text-base font-bold text-ink">Search your authorized catalog</h2><p className="text-sm text-muted">Control number, model, brand, or product type.</p></div></div>
          <form onSubmit={(event) => event.preventDefault()} className="flex min-w-0 items-center gap-2 rounded-control border border-border-strong bg-white px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-focus">
            <Search aria-hidden="true" className="size-5 shrink-0 text-muted" />
            <input aria-label="Search local catalog" placeholder="Try a control number, model, or brand" value={query} onChange={(event) => handleLookupInputChange(event.target.value)} autoComplete="off" className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted" />
            {query && <button type="button" aria-label="Clear catalog search" onClick={() => handleQueryChange('')} className="grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-alt"><X aria-hidden="true" /></button>}
            <button type="button" aria-label="Scan QR code" onClick={() => setIsScannerOpen(true)} className="grid size-10 shrink-0 place-items-center rounded-md text-primary hover:bg-primary-soft"><Camera aria-hidden="true" /></button>
          </form>
          <div role="group" aria-label="Product type" className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {['', ...ecpTypes].map((type) => <button key={type || 'all'} type="button" onClick={() => setEcpTypeFilter(type)} aria-pressed={ecpTypeFilter === type} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${ecpTypeFilter === type ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong bg-white text-ink hover:bg-surface-alt'}`}>{type || 'All types'}</button>)}
          </div>
        </div>
      </Surface>

      {officialLoading && <InlineNotice severity="info">Reading the official DOE record…</InlineNotice>}
      {officialError && <InlineNotice severity={officialError === 'RATE_LIMITED' ? 'warning' : 'info'} action={officialUrl ? <a className="ml-auto text-sm font-semibold text-primary" href={officialUrl} target="_blank" rel="noreferrer">Open on DOE site</a> : undefined}>{officialError === 'RATE_LIMITED' ? 'The DOE lookup limit was reached. Try again later.' : officialError === 'PARSE_FAILED' ? "Couldn't read this record." : officialError === 'OFFLINE' ? 'This record is not saved on this browser yet. Connect to the internet to look it up.' : "The DOE site isn't reachable right now."}</InlineNotice>}
      {officialRecord && officialUrl && <OfficialProductCard record={officialRecord} cached={officialCached} savedAt={officialSavedAt} loading={officialLoading} onRefresh={officialError === 'RATE_LIMITED' ? undefined : () => void resolveOfficialRecord(officialUrl, true)} />}

      <Section title="Catalog results">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-sm text-muted">
              {status === "loading"
                ? "Searching locally…"
                : `${visibleRows.length} ${visibleRows.length === 1 ? "product" : "products"} found on this device`}
            </p>
          <span className="rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-muted">
            {catalogSyncStatus === "checking"
                ? "Updating catalog…"
                : catalogSyncStatus === "error"
                  ? "Catalog update unavailable"
                  : "Stored locally"}
            </span>
        </div>

        {status === "loading" ? (
          <div role="status" aria-label="Loading catalog results" className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-36 animate-pulse rounded-xl border border-border bg-surface-alt" />
            ))}
          </div>
        ) : status === "error" ? (
          <InlineNotice severity="error">
            The local catalog could not be read. Refresh to try again.
          </InlineNotice>
        ) : visibleRows.length > 0 ? (
          <ul aria-label="Local catalog results" className="min-w-0 space-y-3 p-0">
            {visibleRows.map((row) => <CatalogResult key={row.id} row={row} />)}
          </ul>
        ) : (
          <InlineNotice severity="info">
            {query
              ? `No products match “${query}”. Try a control number, model, or brand.`
              : ecpTypeFilter
                ? `No ${ecpTypeFilter} products are stored on this browser.`
                : "No catalog products are stored on this browser yet."}
          </InlineNotice>
        )}
      </div>
      </Section>

      <QrScannerDialog
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={handleQrDetected}
      />
      </div>
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
  const router = useRouter();
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
    <li className="min-w-0 list-none">
      <Surface className="overflow-hidden">
        <ListRow
          leading={<span className="grid size-10 place-items-center rounded-full bg-surface-alt text-primary"><Archive aria-hidden="true" /></span>}
          primary={<span className="break-all font-mono text-[13px] font-semibold">{title}</span>}
          secondary={[brand, model].filter(Boolean).join(' · ') || 'Catalog item'}
          trailing={<div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center"><span className="text-xs text-muted">{productType || 'Uncategorized'}</span><span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{catalogLabel}</span><Link href={`/inspect/new?catalogId=${encodeURIComponent(row.id)}`} onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push(`/inspect/${crypto.randomUUID()}?catalogId=${encodeURIComponent(row.id)}`);
          }} className="inline-flex min-h-10 items-center rounded-control border border-border-strong px-3 text-sm font-semibold text-primary">Inspect</Link></div>}
        />
      </Surface>
      <div className="mt-2"><CatalogDetails row={row} /></div>
    </li>
  );
}

function firstText(row: CatalogRecord, keys: string[]): string | undefined {
  const value = keys
    .map((key) => row[key])
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : undefined;
}
