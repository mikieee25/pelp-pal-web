import { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { RefreshRounded, OpenInNewRounded, StarRounded } from '@mui/icons-material';
import { getLabelValidityStatus, type OfficialProductRecord } from './doe-record';

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
    <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: 'primary.light', borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box>
            <Typography variant="h6" component="h2">Official record</Typography>
            <Typography variant="body2" color="text.secondary">Control number: {record.controlNumber}</Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button component="a" href={record.sourceUrl} target="_blank" rel="noreferrer" size="small" startIcon={<OpenInNewRounded />}>Open on DOE site</Button>
            {onRefresh && <Button size="small" variant="outlined" startIcon={<RefreshRounded />} disabled={loading} onClick={onRefresh}>Refresh</Button>}
          </Stack>
        </Stack>
        {cached && <Alert severity="info" sx={{ py: 0 }}>Saved {savedAt ? new Date(savedAt).toLocaleString() : 'locally'}; official images are available only while online.</Alert>}
        {record.partial && <Alert severity="warning" sx={{ py: 0 }}>The catalog match is available, but some official details could not be read.</Alert>}
        {details.length > 0 && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
          {details.map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography></Box>)}
        </Box>}
        <Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2">Energy rating</Typography><Box sx={{ display: 'inline-flex', color: 'warning.main' }}>{Array.from({ length: record.starRating }, (_, index) => <StarRounded key={index} fontSize="small" />)}</Box><Typography variant="body2" color="text.secondary">{record.starRating}/5</Typography></Stack>
        {record.energyLabels.length > 0 && <Box><Typography variant="subtitle2" gutterBottom>Energy labels</Typography><Stack spacing={1}>{record.energyLabels.map((label) => { const status = getLabelValidityStatus(label.validFrom, label.validUntil); return <Stack key={`${label.labelNumber}-${label.validFrom}`} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}><Typography variant="body2" sx={{ minWidth: { sm: 220 } }}>{label.labelNumber}</Typography><Typography variant="body2" color="text.secondary">{label.validFrom ?? '—'} – {label.validUntil ?? '—'}</Typography><Chip size="small" label={status.label} color={status.kind === 'expired' ? 'error' : status.kind === 'expiring' ? 'warning' : 'success'} /></Stack>; })}</Stack></Box>}
        {images.length > 0 && <Box><Divider sx={{ mb: 1.25 }} /><Stack direction="row" spacing={1} flexWrap="wrap">{images.map((image) => <Box key={image} component="img" src={image} alt="DOE official product" loading="lazy" referrerPolicy="no-referrer" sx={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 1, border: 1, borderColor: 'divider' }} />)}</Stack>{record.imageUrls.length > 1 && <Button size="small" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show one' : `Show all (${record.imageUrls.length})`}</Button>}</Box>}
        <Typography variant="caption" color="text.secondary">Fetched {relativeTime(record.fetchedAt)}</Typography>
      </Stack>
    </Paper>
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
