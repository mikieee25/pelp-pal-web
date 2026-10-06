import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import type { CatalogRecord } from '@/lib/db/records';

export type CatalogDetail = {
  label: string;
  value: string;
};

const canonicalFields: Array<{ key: string; label: string }> = [
  { key: 'id', label: 'Catalog ID' },
  { key: 'control_number', label: 'Control number' },
  { key: 'product_control_number', label: 'Product control number' },
  { key: 'controlNumber', label: 'Control number' },
  { key: 'product_type', label: 'Product Type' },
  { key: 'productType', label: 'Product Type' },
  { key: 'ecp_type', label: 'Product Type' },
  { key: 'ecpType', label: 'Product Type' },
  { key: 'brand', label: 'Brand' },
  { key: 'model_number', label: 'Model' },
  { key: 'modelNumber', label: 'Model' },
  { key: 'model', label: 'Model' },
  { key: 'source_version', label: 'Source version' },
  { key: 'updated_at', label: 'Updated at' },
];

export function getCatalogDetails(row: CatalogRecord): CatalogDetail[] {
  const details: CatalogDetail[] = [];
  const seenCanonicalValues = new Set<string>();

  for (const field of canonicalFields) {
    const value = formatCatalogValue(row[field.key]);
    if (!value) {
      continue;
    }

    const identity = `${field.label}:${value}`;
    if (seenCanonicalValues.has(identity)) {
      continue;
    }

    seenCanonicalValues.add(identity);
    details.push({ label: field.label, value });
  }

  const dynamicFields = parseDynamicFields(row.dynamic_fields);
  for (const [label, rawValue] of dynamicFields) {
    const value = formatCatalogValue(rawValue);
    if (value) {
      details.push({ label, value });
    }
  }

  return details;
}

export function CatalogDetails({
  row,
  defaultExpanded = false,
}: {
  row: CatalogRecord;
  defaultExpanded?: boolean;
}) {
  const details = getCatalogDetails(row);

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      elevation={0}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        overflowAnchor: 'none',
        '&:before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreRounded />}
        aria-controls={`catalog-details-${row.id}`}
      >
        <Stack spacing={0.25}>
          <Typography variant="subtitle2" fontWeight={700}>
            Full product information
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {details.length} catalog fields
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails id={`catalog-details-${row.id}`}>
        <Divider sx={{ mb: 2 }} />
        {details.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: 'repeat(2, minmax(0, 1fr))',
              },
              gap: 1.5,
            }}
          >
            {details.map((detail, index) => (
              <Box
                key={`${detail.label}-${index}`}
                sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
              >
                <Typography variant="caption" color="text.secondary">
                  {detail.label}
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {detail.value}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No product information is available in this catalog row.
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function parseDynamicFields(value: unknown): Array<[string, unknown]> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed);
    }
  } catch {
    return [['Dynamic fields', value]];
  }

  return [];
}

function formatCatalogValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}
