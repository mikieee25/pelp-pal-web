'use client';

import { useState } from 'react';
import { Check, Download, Wifi } from 'lucide-react';
import { getBrowserRepository } from '@/lib/db/browser';
import { getLocalSession } from '@/lib/auth/local-session-store';
import { prepareOfflineShell } from '@/lib/offline/prepare-shell';
import { syncCatalog } from '@/features/catalog/catalog-sync';
import { InlineNotice, Section, StatusBadge, Surface } from '@/components/ui';
import type { SyncOperation } from '@/lib/sync/coordinator';

type CheckState = 'ready' | 'missing' | 'checking';
type SyncNow = (reason: 'manual' | 'retry', operation?: SyncOperation) => Promise<void>;

export function OfflinePreparation({ syncNow }: { syncNow: SyncNow }) {
  const repository = getBrowserRepository();
  const [account, setAccount] = useState<CheckState>('missing');
  const [catalog, setCatalog] = useState<CheckState>('missing');
  const [shell, setShell] = useState<CheckState>('missing');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [prepared, setPrepared] = useState(false);

  const prepare = async () => {
    setBusy(true);
    setPrepared(false);
    setMessage(undefined);
    setAccount('checking'); setCatalog('checking'); setShell('checking');
    try {
      const local = getLocalSession();
      const scope = local?.authUserId ? repository.getAccountScope() : undefined;
      if (!local || !scope || !navigator.onLine) throw new Error('Connect to the internet and sign in with an active account before preparing this device.');
      setAccount('ready');
      await syncNow('manual', 'full');
      const catalogResult = await syncCatalog();
      if (catalogResult.status === 'skipped' || !catalogResult.catalogRole) throw new Error('Catalog sync is available after signing in with an active account.');
      const role = catalogResult.catalogRole;
      const manifest = await repository.getCatalogManifestState(role);
      const count = await repository.getCatalogProductCount(role);
      if (!manifest || count !== manifest.rowCount || count === 0) throw new Error('The catalog did not pass its local version and product count check.');
      setCatalog('ready');
      const shellResult = await prepareOfflineShell();
      if (!shellResult.templateCached || shellResult.cachedRoutes < 12) throw new Error('The offline app pages or report template are incomplete.');
      setShell('ready');
      setPrepared(true);
      setMessage(`Ready for offline work. ${count.toLocaleString()} catalog products and ${shellResult.cachedRoutes} app pages are saved on this device.`);
    } catch (error) {
      setAccount((value) => value === 'ready' ? value : 'missing');
      if (catalog === 'checking') setCatalog('missing');
      if (shell === 'checking') setShell('missing');
      setMessage(error instanceof Error ? error.message : 'This device could not be prepared for offline use.');
    } finally { setBusy(false); }
  };

  return <Surface className="p-4 sm:p-5" data-testid="offline-preparation">
    <Section title="Prepare for offline work">
      <p className="mb-4 text-sm text-muted">While connected at the office, save your account catalog, pending changes, app pages, and Word report template to this device.</p>
      <ul className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
        <CheckRow label="Signed in account" state={account} />
        <CheckRow label="Catalog saved and verified" state={catalog} />
        <CheckRow label="App pages and Word template" state={shell} />
      </ul>
      {message && <InlineNotice severity={prepared ? 'success' : 'warning'}>{message}</InlineNotice>}
      <button type="button" onClick={() => void prepare()} disabled={busy || (typeof navigator !== 'undefined' && !navigator.onLine)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-50 sm:w-auto">
        {busy ? <><Wifi className="size-4 animate-pulse" />Preparing this device…</> : <><Download className="size-4" />{prepared ? 'Prepare again' : 'Prepare for offline work'}</>}
      </button>
    </Section>
  </Surface>;
}

function CheckRow({ label, state }: { label: string; state: CheckState }) {
  return <li className="flex items-center gap-2"><StatusBadge variant={state === 'ready' ? 'synced' : state === 'checking' ? 'waiting' : 'neutral'} label={state === 'checking' ? `Checking ${label.toLowerCase()}` : label} />{state === 'ready' && <Check aria-hidden="true" className="size-4 text-success" />}</li>;
}
