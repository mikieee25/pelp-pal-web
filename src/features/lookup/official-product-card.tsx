import { useMemo, useState } from 'react';
import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material';
import { RefreshRounded, OpenInNewRounded, StarRounded } from '@mui/icons-material';
import { getLabelValidityStatus, type OfficialProductRecord } from './doe-record';
import { KeyValueList, Section, StatusBadge, Surface } from '@/components/ui';

export function OfficialProductCard({ record, cached, savedAt, loading, onRefresh }: {
  record: OfficialProductRecord;
  cached?: boolean;
  savedAt?: string;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const images = useMemo(() => showAll ? record.imageUrls : record.imageUrls.slice(0, 1), [record.imageUrls, showAll]);
  const details = [
    ['Product type', record.productType],
    ['Brand', record.brand],
    ['Product name', record.productName],
    ['Model code', record.modelCode],
    ['Manufacturer', record.manufacturer],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <Surface sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1.5}>
        <Section title="Official record" actions={<Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button component="a" href={record.sourceUrl} target="_blank" rel="noreferrer" size="small" startIcon={<OpenInNewRounded />}>Open on DOE site</Button>
            {onRefresh && <Button size="small" variant="outlined" startIcon={<RefreshRounded />} disabled={loading} onClick={onRefresh}>Refresh</Button>}
          </Stack>}>
          <KeyValueList items={[
            { label: 'Control number', value: record.controlNumber, mono: true },
            ...details.map(([label, value]) => ({ label, value })),
          ]} />
        </Section>
        {cached && <Alert severity="info" sx={{ py: 0 }}>Saved {savedAt ? new Date(savedAt).toLocaleString() : 'locally'}; official images are available only while online.</Alert>}
        {record.partial && <Alert severity="warning" sx={{ py: 0 }}>The catalog match is available, but some official details could not be read.</Alert>}
        <Section title="Energy rating">
          <Stack direction="row" spacing={1} alignItems="center" aria-label={`Energy rating ${record.starRating} out of 5 stars`}><Box sx={{ display: 'inline-flex', color: 'warning.dark' }}>{Array.from({ length: record.starRating }, (_, index) => <StarRounded key={index} fontSize="small" aria-hidden />)}</Box><Typography variant="body2" fontWeight={600}>{record.starRating}/5 stars</Typography></Stack>
        </Section>
        {record.energyLabels.length > 0 && <Section title="Energy labels"><Stack spacing={1.5}>{record.energyLabels.map((label) => {
          const status = getLabelValidityStatus(label.validFrom, label.validUntil);
          const variant = status.kind === 'expired' ? 'nonCompliant' : status.kind === 'expiring' ? 'waiting' : status.kind === 'unavailable' ? 'neutral' : 'compliant';
          return <Box key={`${label.labelNumber}-${label.validFrom}`} sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Box><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{label.labelNumber}</Typography><Typography variant="body2" color="text.secondary">{label.validFrom ?? '—'} – {label.validUntil ?? '—'}</Typography></Box>
            <StatusBadge variant={variant} label={status.label} />
          </Box>;
        })}</Stack></Section>}
        {images.length > 0 && <Box><Divider sx={{ mb: 1.25 }} /><Stack direction="row" spacing={1} flexWrap="wrap">{images.map((image) => <Box key={image} component="img" src={image} alt="DOE official product" loading="lazy" referrerPolicy="no-referrer" sx={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 1, border: 1, borderColor: 'divider' }} />)}</Stack>{record.imageUrls.length > 1 && <Button size="small" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show one' : `Show all (${record.imageUrls.length})`}</Button>}</Box>}
        <Typography variant="caption" color="text.secondary">Fetched {relativeTime(record.fetchedAt)}</Typography>
      </Stack>
    </Surface>
  );
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
