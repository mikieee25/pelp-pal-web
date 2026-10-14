'use client';

import type { ReactNode } from 'react';
import { Box, Container, Stack, Typography } from '@mui/material';

export function PageContainer({ children, maxWidth = 'lg' }: { children: ReactNode; maxWidth?: 'md' | 'lg' | 'xl' }) {
  return <Container maxWidth={maxWidth} sx={{ minWidth: 0, px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}>{children}</Container>;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'flex-start' }} justifyContent="space-between" sx={{ mb: { xs: 3, md: 4 } }}>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="overline" color="primary.main" sx={{ display: 'block', fontWeight: 800, letterSpacing: '0.1em' }}>{eyebrow}</Typography>
      <Typography component="h1" variant="h4" sx={{ fontWeight: 500, fontSize: { xs: '1.8rem', sm: '2.125rem' } }}>{title}</Typography>
      {subtitle && <Typography color="text.secondary" sx={{ maxWidth: 700 }}>{subtitle}</Typography>}
    </Box>
    {actions && <Box sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}>{actions}</Box>}
  </Stack>;
}
