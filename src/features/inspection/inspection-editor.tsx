'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import { getBrowserRepository } from '@/lib/db/browser';

type Draft = {
  storeName: string;
  controlNumber: string;
  remarks: string;
};

const emptyDraft: Draft = { storeName: '', controlNumber: '', remarks: '' };

export function InspectionEditor({ inspectionId }: { inspectionId: string }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let active = true;
    void repository.getInspectionDraft(inspectionId).then((saved) => {
      if (!active) return;
      if (saved) {
        setDraft({
          storeName: typeof saved.storeName === 'string' ? saved.storeName : '',
          controlNumber: typeof saved.controlNumber === 'string' ? saved.controlNumber : '',
          remarks: typeof saved.remarks === 'string' ? saved.remarks : '',
        });
      }
      setLoaded(true);
    });
    return () => { active = false; };
  }, [inspectionId, repository]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void repository.saveInspectionDraft(inspectionId, draft)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, inspectionId, loaded, repository]);

  return (
    <Paper component="form" sx={{ p: { xs: 2, md: 4 } }} onSubmit={(event) => event.preventDefault()}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Typography component="h1" variant="h4">Inspection</Typography>
          <Chip label={saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved locally' : saveState === 'error' ? 'Save failed' : 'Draft'} color={saveState === 'error' ? 'error' : 'default'} />
        </Stack>
        {saveState === 'error' && <Alert severity="error">The draft could not be saved locally. Keep this page open and retry.</Alert>}
        <TextField label="Store name" value={draft.storeName} onChange={(event) => setDraft((value) => ({ ...value, storeName: event.target.value }))} />
        <TextField label="Product control number" value={draft.controlNumber} onChange={(event) => setDraft((value) => ({ ...value, controlNumber: event.target.value }))} />
        <TextField label="Remarks" multiline minRows={4} value={draft.remarks} onChange={(event) => setDraft((value) => ({ ...value, remarks: event.target.value }))} />
        <Button type="submit" variant="contained">Continue</Button>
      </Stack>
    </Paper>
  );
}
