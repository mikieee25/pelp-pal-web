'use client';

import type { ReactNode } from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';

export function MobileReportCard({
  testId,
  title,
  metrics,
  compliance,
  status,
}: Readonly<{
  testId: string;
  title: string;
  metrics: Array<{ label: string; value: ReactNode }>;
  compliance?: string;
  status?: ReactNode;
}>) {
  return (
    <Paper data-testid={testId} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {status}
            {compliance !== undefined && <Chip label={compliance} color={compliance === 'N/A' ? 'default' : 'primary'} size="small" sx={{ fontWeight: 800 }} />}
          </Stack>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
          {metrics.map((metric) => (
            <Box key={metric.label} sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" display="block">{metric.label}</Typography>
              <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{metric.value}</Typography>
            </Box>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}
