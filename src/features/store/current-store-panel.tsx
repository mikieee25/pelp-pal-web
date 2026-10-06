'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Stack, Typography } from '@mui/material';
import { DeleteOutlineRounded, EditRounded, ExpandMoreRounded, MoreVertRounded, SwapHorizRounded, StoreRounded } from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import type { StoreRecord } from '@/lib/db/records';

export function CurrentStorePanel({ returnTo = '/activity' }: { returnTo?: string }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const [store, setStore] = useState<StoreRecord>();
  const [savedStores, setSavedStores] = useState<StoreRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [finished, setFinished] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
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
      setFinished(true);
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
      setFinished(false);
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
      <Alert
        severity="info"
        action={<Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button component={Link} href={storeFormHref(returnTo)} size="small">Enter store details</Button>
          {savedStores.length > 0 && <Button onClick={() => setSwitcherOpen(true)} size="small" startIcon={<SwapHorizRounded />}>Switch active store</Button>}
        </Stack>}
      >No active store selected.</Alert>
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      <StoreSwitcher open={switcherOpen} stores={savedStores} onClose={() => setSwitcherOpen(false)} onSelect={requestSwitchStore} onDelete={setDeleteTarget} />
      <StoreDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(undefined)} onConfirm={() => void deleteStore()} />
      <StoreActionWarning action={storeActionWarning} onClose={() => setStoreActionWarning(undefined)} onConfirm={() => void confirmStoreAction()} />
    </>;
  }

  return (
    <Paper
      ref={storeCardRef}
      elevation={0}
      sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}
      onContextMenu={(event) => { event.preventDefault(); openStoreActions(event.currentTarget); }}
      onTouchStart={() => { clearLongPress(); longPressTimer.current = window.setTimeout(() => openStoreActions(storeCardRef.current), 650); }}
      onTouchMove={clearLongPress}
      onTouchEnd={clearLongPress}
      onTouchCancel={clearLongPress}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <StoreRounded color="primary" />
          <BoxText store={store} />
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ alignSelf: { xs: 'flex-end', sm: 'auto' } }}>
          <IconButton aria-label={detailsExpanded ? 'Collapse store details' : 'Expand store details'} onClick={() => setDetailsExpanded((current) => !current)} color="primary">
            <ExpandMoreRounded sx={{ transform: detailsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease-out' }} />
          </IconButton>
          <IconButton aria-label="Store actions" onClick={(event) => openStoreActions(event.currentTarget)} color="primary"><MoreVertRounded /></IconButton>
        </Stack>
      </Stack>
      <Collapse in={detailsExpanded} unmountOnExit>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' }, mt: 2 }}>
          {savedStores.length > 0 && <Button onClick={() => setSwitcherOpen(true)} startIcon={<SwapHorizRounded />} variant="outlined" size="small">Switch active store</Button>}
          <Button component={Link} href={storeFormHref(returnTo)} startIcon={<EditRounded />} variant="outlined" size="small">Edit store</Button>
          <Button onClick={() => void requestFinishStore()} variant="text" color="warning" size="small">Finish store</Button>
        </Stack>
        {finished && <Alert severity="success" sx={{ mt: 2 }}>Store finished. Add store details before starting another inspection.</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Collapse>
      <Menu anchorEl={storeMenuAnchor} open={Boolean(storeMenuAnchor)} onClose={() => setStoreMenuAnchor(null)} disableScrollLock>
        <MenuItem onClick={() => { setStoreMenuAnchor(null); setDeleteTarget(store); }}><DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />Delete store</MenuItem>
      </Menu>
      <StoreSwitcher open={switcherOpen} stores={savedStores} onClose={() => setSwitcherOpen(false)} onSelect={requestSwitchStore} onDelete={setDeleteTarget} />
      <StoreDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(undefined)} onConfirm={() => void deleteStore()} />
      <StoreActionWarning action={storeActionWarning} onClose={() => setStoreActionWarning(undefined)} onConfirm={() => void confirmStoreAction()} />
    </Paper>
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
  if (!store) return <Alert severity="warning" action={<Button component={Link} href={storeFormHref(returnTo)} size="small">Enter store details</Button>}>No active store. Enter store details before starting an inspection.</Alert>;
  return <Alert severity="info" icon={<StoreRounded fontSize="inherit" />}><strong>Inspecting at {store.name}</strong>{store.location ? ` · ${store.location}` : ''}</Alert>;
}

function StoreSwitcher({ open, stores, onClose, onSelect, onDelete }: { open: boolean; stores: StoreRecord[]; onClose: () => void; onSelect: (storeId: string) => void; onDelete: (store: StoreRecord) => void }) {
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
    <DialogTitle>Switch active store</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={1}>
        {stores.map((saved) => <Stack key={saved.storeId} direction="row" spacing={0.5} alignItems="stretch">
          <Button onClick={() => onSelect(saved.storeId)} variant="outlined" sx={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', py: 1.25 }}>
            <Stack spacing={0.25} alignItems="flex-start"><Typography fontWeight={700}>{saved.name}</Typography><Typography variant="caption" color="text.secondary">{saved.location}{saved.address ? ` · ${saved.address}` : ''}</Typography></Stack>
          </Button>
          <IconButton aria-label="Delete saved store" title={`Delete ${saved.name}`} color="error" onClick={() => onDelete(saved)}><DeleteOutlineRounded /></IconButton>
        </Stack>)}
      </Stack>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>Cancel</Button></DialogActions>
  </Dialog>;
}

function StoreDeleteDialog({ target, onClose, onConfirm }: { target?: StoreRecord; onClose: () => void; onConfirm: () => void }) {
  return <Dialog open={Boolean(target)} onClose={onClose} disableScrollLock aria-labelledby="delete-store-title">
    <DialogTitle id="delete-store-title">Delete store?</DialogTitle>
    <DialogContent>{target ? `Remove ${target.name} from this device? Completed inspections are kept.` : ''}</DialogContent>
    <DialogActions><Button onClick={onClose}>Cancel</Button><Button color="error" onClick={onConfirm} startIcon={<DeleteOutlineRounded />}>Delete store</Button></DialogActions>
  </Dialog>;
}

function StoreActionWarning({ action, onClose, onConfirm }: { action?: { kind: 'finish' | 'switch'; storeName?: string; drafts: number; pendingSync: number }; onClose: () => void; onConfirm: () => void }) {
  const actionLabel = action?.kind === 'finish' ? 'finish this store' : `switch to ${action?.storeName || 'the selected store'}`;
  return <Dialog open={Boolean(action)} onClose={onClose} aria-labelledby="store-action-warning-title">
    <DialogTitle id="store-action-warning-title">Local work is still pending</DialogTitle>
    <DialogContent>
      You have {action?.drafts ?? 0} draft{action?.drafts === 1 ? '' : 's'} and {action?.pendingSync ?? 0} inspection{action?.pendingSync === 1 ? '' : 's'} waiting to sync. {actionLabel[0]?.toUpperCase()}{actionLabel.slice(1)} and keep that work on this device?
    </DialogContent>
    <DialogActions><Button onClick={onClose}>Keep current store</Button><Button variant="contained" onClick={onConfirm}>Continue</Button></DialogActions>
  </Dialog>;
}

function storeFormHref(returnTo: string): string {
  return `/store?returnTo=${encodeURIComponent(returnTo)}`;
}

function BoxText({ store }: { store: StoreRecord }) {
  return <Stack spacing={0.25}><Typography variant="subtitle1" fontWeight={700}>Active store: {store.name}</Typography><Typography variant="body2" color="text.secondary">{store.location}{store.address ? ` · ${store.address}` : ''}</Typography></Stack>;
}
