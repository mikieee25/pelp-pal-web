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
  const [savedStores, setSavedStores] = useState<Array<StoreDetails & { storeId: string }>>([]);
  const [dismissedMatch, setDismissedMatch] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getCurrentStore(),
      repository.listSavedStores?.() ?? Promise.resolve([]),
    ]).then(([store, saved]) => {
      if (!active) return;
      setSavedStores(saved);
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
    if (field === 'name' || field === 'location') setDismissedMatch(undefined);
    setDetails((current) => ({ ...current, [field]: value }));
  };

  const possibleMatch = details.storeId ? undefined : findPossibleStoreMatch(details, savedStores);
  const possibleMatchKey = possibleMatch ? `${possibleMatch.storeId}:${normalizeStoreName(details.name)}` : undefined;

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
        {possibleMatch && possibleMatchKey !== dismissedMatch && (
          <Alert
            severity="info"
            action={<Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5} alignItems="flex-end">
              <Button size="small" onClick={() => setDetails({ ...possibleMatch, storeId: possibleMatch.storeId })}>Use existing store</Button>
              <Button size="small" onClick={() => setDismissedMatch(possibleMatchKey)}>Keep as new</Button>
            </Stack>}
          >This looks like <strong>{possibleMatch.name}</strong> in {possibleMatch.location}. Confirm if it is the same store to keep inspection history together.</Alert>
        )}
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

function findPossibleStoreMatch(details: StoreDetails, stores: Array<StoreDetails & { storeId: string }>): (StoreDetails & { storeId: string }) | undefined {
  const name = normalizeStoreName(details.name);
  const location = normalizeStoreName(details.location);
  if (name.length < 4 || !location) return undefined;
  return stores
    .filter((store) => normalizeStoreName(store.location) === location)
    .map((store) => ({ store, score: storeNameSimilarity(name, normalizeStoreName(store.name)) }))
    .sort((left, right) => right.score - left.score)
    .find(({ score }) => score >= 0.8)?.store;
}

function normalizeStoreName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function storeNameSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(previous[rightIndex - 1] + 1, above + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/activity';
}
