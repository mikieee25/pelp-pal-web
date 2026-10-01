'use client';

import { useEffect, useState } from 'react';
import { Alert, Container, List, ListItem, ListItemText, Paper, Stack, TextField, Typography } from '@mui/material';
import type { CatalogRecord } from '@/lib/db/records';
import { getBrowserRepository } from '@/lib/db/browser';

export function LookupView() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CatalogRecord[]>([]);

  useEffect(() => {
    let active = true;
    void getBrowserRepository().searchCatalog(query).then((nextRows) => {
      if (active) setRows(nextRows);
    });
    return () => { active = false; };
  }, [query]);

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Product lookup</Typography>
        <Typography color="text.secondary">Search the catalog stored on this device.</Typography>
      </Stack>
      <Paper component="form" sx={{ p: 3 }} onSubmit={(event) => event.preventDefault()}>
        <TextField
          fullWidth
          label="Control number, model, brand, or product type"
          placeholder="Search locally"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          inputProps={{ 'aria-label': 'Search local catalog' }}
        />
        {rows.length > 0 ? (
          <List aria-label="Local catalog results">
            {rows.map((row) => (
              <ListItem key={row.id} divider>
                <ListItemText primary={displayValue(row, ['product_name', 'name', 'model', 'control_number'])} secondary={displayValue(row, ['brand', 'product_type', 'catalogScope'])} />
              </ListItem>
            ))}
          </List>
        ) : (
          <Alert severity="info" sx={{ mt: 2 }}>No matching catalog rows are stored on this browser.</Alert>
        )}
      </Paper>
    </Container>
  );
}

function displayValue(row: CatalogRecord, keys: string[]): string {
  const value = keys.map((key) => row[key]).find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : 'Catalog item';
}
