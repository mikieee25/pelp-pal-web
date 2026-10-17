'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserRepository } from '@/lib/db/browser';
import type { StoreDetails } from '@/lib/db/records';
import { ActionBar, InlineNotice, PageHeader, PageShell, Section } from '@/components/ui';

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
    return <PageShell><PageHeader title="Store details" /><div className="grid min-h-60 place-items-center"><span role="progressbar" aria-label="Loading store details" className="size-8 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" /></div></PageShell>;
  }

  return (
    <PageShell>
      <div className="space-y-6">
        <PageHeader title={details.storeId ? 'Edit store details' : 'Enter store details'} subtitle="Set the active store before starting an inspection." />
        <form onSubmit={handleSubmit} className="space-y-6">
            {error && <InlineNotice severity="error">{error}</InlineNotice>}
            {possibleMatch && possibleMatchKey !== dismissedMatch && (
          <InlineNotice severity="info">This looks like <strong>{possibleMatch.name}</strong> in {possibleMatch.location}. Confirm if it is the same store to keep inspection history together.<span className="ml-auto flex gap-2"><button type="button" className="min-h-10 px-2 text-primary" onClick={() => setDetails({ ...possibleMatch, storeId: possibleMatch.storeId })}>Use existing store</button><button type="button" className="min-h-10 px-2 text-primary" onClick={() => setDismissedMatch(possibleMatchKey)}>Keep as new</button></span></InlineNotice>
        )}
            <Section title="Store details">
              <div className="grid gap-4">
                {details.storeId && <TextInput label="Store ID" value={details.storeId} readOnly />}
                <TextInput label="Store name" value={details.name} onChange={(event) => update('name', event.target.value)} required autoComplete="organization" />
                <label className="block text-sm font-medium text-ink">Location<select value={details.location} onChange={(event) => update('location', event.target.value)} required className="mt-1.5 h-12 w-full rounded-control border border-border-strong bg-white px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-focus"><option value="" disabled>Select a location</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
                <TextInput label="Store address" value={details.address ?? ''} onChange={(event) => update('address', event.target.value)} multiline />
              </div>
            </Section>
            <Section title="Store contact">
              <div className="grid gap-4 md:grid-cols-2">
                <TextInput label="Store representative" value={details.contactName ?? ''} onChange={(event) => update('contactName', event.target.value)} />
                <TextInput label="Position" value={details.contactPosition ?? ''} onChange={(event) => update('contactPosition', event.target.value)} />
                <TextInput label="Contact number" value={details.contactNumber ?? ''} onChange={(event) => update('contactNumber', event.target.value)} type="tel" />
                <TextInput label="Email address" value={details.email ?? ''} onChange={(event) => update('email', event.target.value)} type="email" />
              </div>
            </Section>
            <ActionBar>
              <div className="flex w-full flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" onClick={() => router.replace(returnTo)} disabled={saving} className="min-h-11 rounded-control border border-border-strong px-4 font-semibold text-ink sm:w-auto">Cancel</button><button type="submit" disabled={saving} className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-60 sm:w-auto">{saving ? 'Saving…' : 'Save store details'}</button></div>
            </ActionBar>
        </form>
      </div>
    </PageShell>
  );
}

function TextInput({ label, multiline, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; multiline?: boolean }) {
  const inputId = props.id ?? props.name ?? label.toLowerCase().replace(/\s+/g, '-');
  return <label htmlFor={inputId} className="block text-sm font-medium text-ink">{label}{multiline ? <textarea {...props as React.TextareaHTMLAttributes<HTMLTextAreaElement>} id={inputId} rows={3} className="mt-1.5 w-full rounded-control border border-border-strong bg-white px-3 py-2 text-base outline-none focus:border-primary focus:ring-2 focus:ring-focus" /> : <input {...props} id={inputId} className="mt-1.5 h-12 w-full rounded-control border border-border-strong bg-white px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-focus read-only:bg-surface-alt" />}</label>;
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
