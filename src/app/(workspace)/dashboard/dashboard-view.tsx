'use client';

import { useEffect, useState } from 'react';
import { Container, Grid, Paper, Stack, Typography } from '@mui/material';
import { getBrowserRepository } from '@/lib/db/browser';

type Counts = {
  completedInspections: number;
  drafts: number;
  pendingSync: number;
  openConflicts: number;
};

const emptyCounts: Counts = { completedInspections: 0, drafts: 0, pendingSync: 0, openConflicts: 0 };

export function DashboardView() {
  const [counts, setCounts] = useState<Counts>(emptyCounts);

  useEffect(() => {
    let active = true;
    void getBrowserRepository().getDashboardCounts().then((nextCounts) => {
      if (active) setCounts(nextCounts);
    });
    return () => { active = false; };
  }, []);

  const cards = [
    ['Completed inspections', counts.completedInspections],
    ['Drafts on this device', counts.drafts],
    ['Pending sync', counts.pendingSync],
    ['Open conflicts', counts.openConflicts],
  ] as const;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Typography component="h1" variant="h4">Dashboard</Typography>
        <Typography color="text.secondary">A local view of this authorized device&apos;s inspection work.</Typography>
      </Stack>
      <Grid container spacing={2}>
        {cards.map(([label, value]) => (
          <Grid key={label} size={{ xs: 12, sm: 6, md: 3 }}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Typography color="text.secondary" variant="body2">{label}</Typography>
              <Typography component="p" variant="h3" sx={{ mt: 1 }}>{value}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}
