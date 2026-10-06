'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserRepository } from '@/lib/db/browser';
import type { StoreDetails } from '@/lib/db/records';

const locations = ['NCR', 'Luzon', 'Visayas', 'Mindanao'];

export function StoreForm() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [details, setDetails] = useState<StoreDetails>({ name: '', location: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void repository.getCurrentStore().then((store) => {
      if (!active) return;
      if (store) {
        setDetails({
          storeId: store.storeId,
          name: store.name,
          location: store.location,
          address: store.address,
          contactName: store.contactName,
          contactPosition: store.contactPosition,
          contactNumber: store.contactNumber,
          email: store.email,
        });
      }
      setLoaded(true);
    }).catch(() => {
      if (active) {
        setError('Store details could not be loaded. Refresh and try again.');
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, [repository]);

  const update = (field: keyof StoreDetails, value: string) => {
    setDetails((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!details.name.trim() || !details.location.trim()) {
      setError('Store name and location are required.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await repository.saveCurrentStore(details);
      router.replace(returnTo);
    } catch {
      setError('Store details could not be saved locally. Try again.');
      setSaving(false);
    }
  };

  if (!loaded) {
    return <Paper sx={{ p: { xs: 2, sm: 3, md: 4 }, display: 'grid', placeItems: 'center', minHeight: 240 }}><CircularProgress aria-label="Loading store details" /></Paper>;
  }

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
      <Stack spacing={2.25}>
        <Stack spacing={0.5}>
          <Typography component="h1" variant="h4">{details.storeId ? 'Edit store details' : 'Enter store details'}</Typography>
          <Typography color="text.secondary">Set the active store before starting an inspection.</Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {details.storeId && <TextField label="Store ID" value={details.storeId} slotProps={{ input: { readOnly: true } }} />}
        <TextField label="Store name" value={details.name} onChange={(event) => update('name', event.target.value)} required autoComplete="organization" />
        <TextField select label="Location" value={details.location} onChange={(event) => update('location', event.target.value)} required>
          {locations.map((location) => <MenuItem key={location} value={location}>{location}</MenuItem>)}
        </TextField>
        <TextField label="Store address" value={details.address ?? ''} onChange={(event) => update('address', event.target.value)} multiline minRows={2} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField fullWidth label="Store representative" value={details.contactName ?? ''} onChange={(event) => update('contactName', event.target.value)} />
          <TextField fullWidth label="Position" value={details.contactPosition ?? ''} onChange={(event) => update('contactPosition', event.target.value)} />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField fullWidth label="Contact number" value={details.contactNumber ?? ''} onChange={(event) => update('contactNumber', event.target.value)} type="tel" />
          <TextField fullWidth label="Email address" value={details.email ?? ''} onChange={(event) => update('email', event.target.value)} type="email" />
        </Stack>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
          <Button type="button" onClick={() => router.replace(returnTo)} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save store details'}</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/activity';
}
