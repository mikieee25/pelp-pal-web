'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, ChevronRight, Ellipsis, Pencil, Store, Trash2 } from 'lucide-react';
import { getBrowserRepository } from '@/lib/db/browser';
import type { StoreRecord } from '@/lib/db/records';
import { InlineNotice, ListRow, Surface } from '@/components/ui';
import { AccessibleModal } from '@/components/ui/accessible-overlay';

export function CurrentStorePanel({ returnTo = '/activity', compactMobile = false }: { returnTo?: string; compactMobile?: boolean }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const [store, setStore] = useState<StoreRecord>();
  const [savedStores, setSavedStores] = useState<StoreRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [storeMenuAnchor, setStoreMenuAnchor] = useState<HTMLElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoreRecord>();
  const [storeActionWarning, setStoreActionWarning] = useState<{ kind: 'finish' | 'switch'; storeId?: string; storeName?: string; drafts: number; pendingSync: number }>();
  const storeCardRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getCurrentStore(),
      repository.listSavedStores?.() ?? Promise.resolve([]),
    ]).then(([current, saved]) => {
      if (active) {
        setStore(current);
        setSavedStores(saved);
        setLoaded(true);
      }
    }).catch(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, [repository]);

  const finishStore = async () => {
    try {
      await repository.finishCurrentStore();
      setStore(undefined);
      setError(undefined);
    } catch {
      setError('The active store could not be finished on this device. Try again.');
    }
  };

  const requestFinishStore = async () => {
    const counts = await repository.getDashboardCounts?.();
    if (counts && (counts.drafts > 0 || counts.pendingSync > 0)) {
      setStoreActionWarning({ kind: 'finish', drafts: counts.drafts, pendingSync: counts.pendingSync });
      return;
    }
    await finishStore();
  };

  const switchStore = async (storeId: string) => {
    try {
      const next = await repository.switchCurrentStore(storeId);
      setStore(next);
      setSwitcherOpen(false);
      setError(undefined);
    } catch {
      setError('The selected store could not be activated on this device. Try again.');
    }
  };

  const requestSwitchStore = async (storeId: string) => {
    const counts = await repository.getDashboardCounts?.();
    const selected = savedStores.find((saved) => saved.storeId === storeId);
    if (counts && (counts.drafts > 0 || counts.pendingSync > 0)) {
      setStoreActionWarning({ kind: 'switch', storeId, storeName: selected?.name, drafts: counts.drafts, pendingSync: counts.pendingSync });
      return;
    }
    await switchStore(storeId);
  };

  const confirmStoreAction = async () => {
    const action = storeActionWarning;
    setStoreActionWarning(undefined);
    if (!action) return;
    if (action.kind === 'finish') await finishStore();
    else if (action.storeId) await switchStore(action.storeId);
  };

  const deleteStore = async () => {
    if (!deleteTarget) return;
    try {
      await repository.deleteSavedStore(deleteTarget.storeId);
      setSavedStores((current) => current.filter((saved) => saved.storeId !== deleteTarget.storeId));
      if (store?.storeId === deleteTarget.storeId) setStore(undefined);
      setDeleteTarget(undefined);
      setError(undefined);
    } catch {
      setError('The store could not be deleted from this device. Try again.');
    }
  };

  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const openStoreActions = (anchor: HTMLElement | null) => {
    if (anchor) setStoreMenuAnchor(anchor);
  };

  if (!loaded) return null;
  if (!store) {
    return <>
      <Surface>
        {compactMobile && <Link href={storeFormHref(returnTo)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left text-sm font-semibold text-ink sm:hidden"><span className="truncate">Store: Select a store</span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" /></Link>}
        <div className={compactMobile ? 'hidden sm:block' : ''}>
        <ListRow
          leading={<Store aria-hidden="true" className="size-5 text-primary" />}
          primary="Select a store"
          secondary="Choose the store for this inspection."
          trailing={<div className="flex flex-col gap-2 sm:flex-row">
            {savedStores.length > 0 && <button type="button" onClick={() => setSwitcherOpen(true)} aria-label="Switch active store" className="min-h-11 rounded-control px-3 font-semibold text-primary"><ArrowLeftRight aria-hidden="true" className="mr-2 inline size-4" />Change</button>}
            <Link className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-3 font-semibold text-white" href={storeFormHref(returnTo)}>Enter store details</Link>
          </div>}
        />
        </div>
      </Surface>
      {error && <InlineNotice severity="warning">{error}</InlineNotice>}
      <StoreSwitcher open={switcherOpen} stores={savedStores} onClose={() => setSwitcherOpen(false)} onSelect={requestSwitchStore} onDelete={setDeleteTarget} />
      <StoreDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(undefined)} onConfirm={() => void deleteStore()} />
      <StoreActionWarning action={storeActionWarning} onClose={() => setStoreActionWarning(undefined)} onConfirm={() => void confirmStoreAction()} />
    </>;
  }

  return (
    <Surface
      ref={storeCardRef}
      className="relative"
      data-testid="current-store-panel"
      onContextMenu={(event) => { event.preventDefault(); openStoreActions(event.currentTarget); }}
      onTouchStart={() => { clearLongPress(); longPressTimer.current = window.setTimeout(() => openStoreActions(storeCardRef.current), 650); }}
      onTouchMove={clearLongPress}
      onTouchEnd={clearLongPress}
      onTouchCancel={clearLongPress}
    >
      {compactMobile && (savedStores.length > 0 ? (
        <button type="button" aria-label={`Store: ${store.name}. Change active store`} onClick={() => setSwitcherOpen(true)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus sm:hidden"><span className="truncate">Store: {store.name}</span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" /></button>
      ) : (
        <Link href={storeFormHref(returnTo)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus sm:hidden"><span className="truncate">Store: {store.name}</span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" /></Link>
      ))}
      <div className={compactMobile ? 'hidden sm:block' : ''}>
      <ListRow
        leading={<Store aria-hidden="true" className="size-5 text-primary" />}
        primary={`Store: ${store.name}`}
        secondary={store.location}
        trailing={<div className="flex items-center gap-1">
          {savedStores.length > 0 && <button type="button" aria-label="Switch active store" onClick={() => setSwitcherOpen(true)} className="min-h-11 rounded-control px-3 font-semibold text-primary"><ArrowLeftRight aria-hidden="true" className="mr-2 inline size-4" />Change</button>}
          <button type="button" aria-label="Store actions" onClick={(event) => openStoreActions(event.currentTarget)} className="grid size-11 place-items-center rounded-full text-primary hover:bg-primary-soft"><Ellipsis aria-hidden="true" /></button>
        </div>}
      />
      </div>
      {error && <InlineNotice severity="warning">{error}</InlineNotice>}
      {storeMenuAnchor && <div role="menu" aria-label="Store actions" className="absolute right-2 top-full z-40 mt-1 min-w-48 rounded-control border border-border bg-white p-1 shadow-xl">
        <Link role="menuitem" href={storeFormHref(returnTo)} onClick={() => setStoreMenuAnchor(null)} className="block min-h-11 rounded px-3 py-2 text-sm hover:bg-surface-alt"><Pencil className="mr-2 inline size-4" />Edit store</Link>
        <button role="menuitem" type="button" onClick={() => { setStoreMenuAnchor(null); void requestFinishStore(); }} className="block min-h-11 w-full rounded px-3 py-2 text-left text-sm hover:bg-surface-alt"><Store className="mr-2 inline size-4" />Finish store</button>
        <button role="menuitem" type="button" onClick={() => { setStoreMenuAnchor(null); setDeleteTarget(store); }} className="block min-h-11 w-full rounded px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft"><Trash2 className="mr-2 inline size-4" />Delete store</button>
      </div>}
      <StoreSwitcher open={switcherOpen} stores={savedStores} onClose={() => setSwitcherOpen(false)} onSelect={requestSwitchStore} onDelete={setDeleteTarget} />
      <StoreDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(undefined)} onConfirm={() => void deleteStore()} />
      <StoreActionWarning action={storeActionWarning} onClose={() => setStoreActionWarning(undefined)} onConfirm={() => void confirmStoreAction()} />
    </Surface>
  );
}

export function ActiveStoreBanner({ returnTo = '/lookup' }: { returnTo?: string }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const [store, setStore] = useState<StoreRecord>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.getCurrentStore().then((current) => {
      if (active) {
        setStore(current);
        setLoaded(true);
      }
    }).catch(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, [repository]);

  if (!loaded) return null;
  if (!store) return <InlineNotice severity="warning">No active store. <Link className="font-semibold underline" href={storeFormHref(returnTo)}>Enter store details</Link> before starting an inspection.</InlineNotice>;
  return <InlineNotice severity="info"><Store aria-hidden="true" className="mr-2 inline size-4" /><strong>Inspecting at {store.name}</strong>{store.location ? ` · ${store.location}` : ''}</InlineNotice>;
}

function StoreSwitcher({ open, stores, onClose, onSelect, onDelete }: { open: boolean; stores: StoreRecord[]; onClose: () => void; onSelect: (storeId: string) => void; onDelete: (store: StoreRecord) => void }) {
  if (!open) return null;
  return <AccessibleModal onClose={onClose} labelledBy="switch-store-title" className="max-h-[85dvh] max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><h2 id="switch-store-title" className="mb-4 text-lg font-semibold text-ink">Switch active store</h2><div className="space-y-2">
    {stores.map((saved) => <div key={saved.storeId} className="flex items-center gap-2"><button type="button" onClick={() => onSelect(saved.storeId)} className="min-h-14 flex-1 rounded-control border border-border-strong px-3 py-2 text-left hover:bg-surface-alt"><span className="block font-semibold text-ink">{saved.name}</span><span className="block text-xs text-muted">{saved.location}{saved.address ? ` · ${saved.address}` : ''}</span></button><button type="button" aria-label="Delete saved store" title={`Delete ${saved.name}`} onClick={() => onDelete(saved)} className="grid size-11 place-items-center rounded-full text-danger"><Trash2 aria-hidden="true" /></button></div>)}
    </div><div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 font-semibold text-primary">Cancel</button></div></AccessibleModal>;
}

function StoreDeleteDialog({ target, onClose, onConfirm }: { target?: StoreRecord; onClose: () => void; onConfirm: () => void }) {
  if (!target) return null;
  return <AccessibleModal onClose={onClose} labelledBy="delete-store-title" className="max-w-md rounded-2xl bg-white p-5 shadow-xl"><h2 id="delete-store-title" className="text-lg font-semibold text-ink">Delete store?</h2><p className="mt-3 text-sm text-muted">Remove {target.name} from this device? Completed inspections are kept.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 font-semibold">Cancel</button><button type="button" onClick={onConfirm} className="min-h-11 rounded-control bg-danger px-4 font-semibold text-white"><Trash2 className="mr-2 inline size-4" />Delete store</button></div></AccessibleModal>;
}

function StoreActionWarning({ action, onClose, onConfirm }: { action?: { kind: 'finish' | 'switch'; storeName?: string; drafts: number; pendingSync: number }; onClose: () => void; onConfirm: () => void }) {
  const actionLabel = action?.kind === 'finish' ? 'finish this store' : `switch to ${action?.storeName || 'the selected store'}`;
  if (!action) return null;
  return <AccessibleModal onClose={onClose} labelledBy="store-action-warning-title" className="max-w-md rounded-2xl bg-white p-5 shadow-xl"><h2 id="store-action-warning-title" className="text-lg font-semibold text-ink">Local work is still pending</h2><p className="mt-3 text-sm text-muted">You have {action.drafts} draft{action.drafts === 1 ? '' : 's'} and {action.pendingSync} inspection{action.pendingSync === 1 ? '' : 's'} waiting to sync. {actionLabel[0]?.toUpperCase()}{actionLabel.slice(1)} and keep that work on this device?</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-control px-4 font-semibold">Keep current store</button><button type="button" onClick={onConfirm} className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white">Continue</button></div></AccessibleModal>;
}

function storeFormHref(returnTo: string): string {
  return `/store?returnTo=${encodeURIComponent(returnTo)}`;
}
