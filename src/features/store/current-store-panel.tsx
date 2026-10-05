'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { EditRounded, StoreRounded } from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import type { StoreRecord } from '@/lib/db/records';

export function CurrentStorePanel() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const [store, setStore] = useState<StoreRecord>();
  const [loaded, setLoaded] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.getCurrentStore().then((current) => {
      if (active) {
        setStore(current);
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, [repository]);

  const finishStore = async () => {
    await repository.finishCurrentStore();
    setStore(undefined);
    setFinished(true);
  };

  if (!loaded) return null;
  if (!store) {
    return <Alert severity="info" action={<Button component={Link} href="/store?returnTo=%2Factivity" size="small">Add store</Button>}>No active store selected.</Alert>;
  }

  return (
    <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <StoreRounded color="primary" />
          <BoxText store={store} />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          <Button component={Link} href="/store?returnTo=%2Factivity" startIcon={<EditRounded />} variant="outlined" size="small">Edit store</Button>
          <Button onClick={() => void finishStore()} variant="text" color="warning" size="small">Finish store</Button>
        </Stack>
      </Stack>
      {finished && <Alert severity="success" sx={{ mt: 2 }}>Store finished. Add store details before starting another inspection.</Alert>}
    </Paper>
  );
}

function BoxText({ store }: { store: StoreRecord }) {
  return <Stack spacing={0.25}><Typography variant="subtitle1" fontWeight={700}>Active store: {store.name}</Typography><Typography variant="body2" color="text.secondary">{store.location}{store.address ? ` · ${store.address}` : ''}</Typography></Stack>;
}
