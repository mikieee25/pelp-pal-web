'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import { createEnrollmentCodeClient } from '@/features/enrollment/enrollment-code-client';

type CopyState = 'idle' | 'copied' | 'manual';

export function EnrollmentCodePanel({ currentUsername }: Readonly<{ currentUsername: string | null }>) {
  const client = useMemo(() => createEnrollmentCodeClient(), []);
  const [targetUsername, setTargetUsername] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [assignedUsername, setAssignedUsername] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const issueCode = async () => {
    setSaving(true);
    setCode(null);
    setAssignedUsername(null);
    setExpiresAt(null);
    setCopyState('idle');
    setError(null);
    try {
      const result = await client.issue(targetUsername);
      setCode(result.code);
      setAssignedUsername(result.assignedUsername);
      setExpiresAt(result.expiresAt);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Enrollment-code generation failed.');
    } finally {
      setSaving(false);
    }
  };

  const copyCode = async () => {
    if (!code || !navigator.clipboard?.writeText) {
      setCopyState('manual');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  };

  return (
    <Paper component="section" aria-labelledby="enrollment-code-title" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <VpnKeyOutlinedIcon color="primary" />
          <BoxTitle currentUsername={currentUsername} />
        </Stack>
        <TextField
          label="Target personnel username"
          value={targetUsername}
          onChange={(event) => setTargetUsername(event.target.value)}
          autoComplete="off"
          fullWidth
          helperText="The target must be an active account in your organization."
          disabled={saving}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button variant="contained" onClick={() => void issueCode()} disabled={saving || !targetUsername.trim()}>
          {saving ? 'Generating code…' : 'Generate code'}
        </Button>
        {code && assignedUsername && expiresAt && (
          <Stack spacing={1.25} sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Typography variant="body2">Enrollment code for <strong>{assignedUsername}</strong></Typography>
            <Typography
              component="code"
              aria-label="Generated enrollment code"
              sx={{ fontFamily: 'monospace', fontSize: { xs: '2rem', sm: '2.4rem' }, fontWeight: 800, letterSpacing: '0.18em' }}
            >
              {code}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Expires {new Date(expiresAt).toLocaleString()}. Generating another code invalidates the previous usable code for this account.
            </Typography>
            <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={() => void copyCode()}>
              Copy code
            </Button>
            {copyState === 'copied' && <Alert severity="success">Code copied.</Alert>}
            {copyState === 'manual' && <Alert severity="info">Copy the code manually from the code shown above.</Alert>}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function BoxTitle({ currentUsername }: Readonly<{ currentUsername: string | null }>) {
  return (
    <Stack spacing={0.25}>
      <Typography id="enrollment-code-title" variant="h6">Enrollment code</Typography>
      <Typography variant="body2" color="text.secondary">
        Generate a one-time browser code{currentUsername ? ` as ${currentUsername}` : ''}.
      </Typography>
    </Stack>
  );
}
