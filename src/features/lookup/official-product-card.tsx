import { useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Star } from 'lucide-react';
import { getLabelValidityStatus, type OfficialProductRecord } from './doe-record';
import { InlineNotice, KeyValueList, Section, StatusBadge, Surface } from '@/components/ui';

export function OfficialProductCard({ record, cached, savedAt, loading, onRefresh }: {
  record: OfficialProductRecord; cached?: boolean; savedAt?: string; loading?: boolean; onRefresh?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const images = useMemo(() => showAll ? record.imageUrls : record.imageUrls.slice(0, 1), [record.imageUrls, showAll]);
  const details = [['Product type', record.productType], ['Brand', record.brand], ['Product name', record.productName], ['Model code', record.modelCode], ['Manufacturer', record.manufacturer]].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return <Surface className="space-y-5 p-4 sm:p-6">
    <Section title="Official record" actions={<div className="flex flex-col gap-2 sm:flex-row">
      <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border-strong px-3 text-sm font-semibold text-primary hover:bg-primary-soft"><ExternalLink aria-hidden="true" className="size-4" />Open on DOE site</a>
      {onRefresh && <button type="button" disabled={loading} onClick={onRefresh} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border-strong px-3 text-sm font-semibold text-primary disabled:opacity-50"><RefreshCw aria-hidden="true" className="size-4" />Refresh</button>}
    </div>}>
      <KeyValueList items={[{ label: 'Control number', value: record.controlNumber, mono: true }, ...details.map(([label, value]) => ({ label, value }))]} />
    </Section>
    {cached && <InlineNotice severity="info">Saved {savedAt ? new Date(savedAt).toLocaleString() : 'locally'}; official images are available only while online.</InlineNotice>}
    {record.partial && <InlineNotice severity="warning">The catalog match is available, but some official details could not be read.</InlineNotice>}
    <Section title="Energy rating"><div className="flex items-center gap-2" aria-label={`Energy rating ${record.starRating} out of 5 stars`}><span className="inline-flex text-warning">{Array.from({ length: record.starRating }, (_, index) => <Star key={index} aria-hidden="true" className="size-4 fill-current" />)}</span><span className="text-sm font-semibold text-ink">{record.starRating}/5 stars</span></div></Section>
    {record.energyLabels.length > 0 && <Section title="Energy labels"><ul className="space-y-3">{record.energyLabels.map((label) => {
      const status = getLabelValidityStatus(label.validFrom, label.validUntil);
      const variant = status.kind === 'expired' ? 'nonCompliant' : status.kind === 'expiring' ? 'waiting' : status.kind === 'unavailable' ? 'neutral' : 'compliant';
      return <li key={`${label.labelNumber}-${label.validFrom}`} className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><div className="break-all text-sm font-semibold text-ink">{label.labelNumber}</div><div className="text-sm text-muted">{label.validFrom ?? '—'} – {label.validUntil ?? '—'}</div></div><StatusBadge variant={variant} label={status.label} /></li>;
    })}</ul></Section>}
    {images.length > 0 && <div className="border-t border-border pt-4"><div className="flex flex-wrap gap-2">{images.map((image) => <img key={image} src={image} alt="DOE official product" loading="lazy" referrerPolicy="no-referrer" className="size-24 rounded-lg border border-border object-contain" />)}</div>{record.imageUrls.length > 1 && <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 min-h-10 text-sm font-semibold text-primary">{showAll ? 'Show one' : `Show all (${record.imageUrls.length})`}</button>}</div>}
    <p className="text-xs text-muted">Fetched {relativeTime(record.fetchedAt)}</p>
  </Surface>;
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return 'just now'; const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`; const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`; return `${Math.round(hours / 24)} days ago`;
}
