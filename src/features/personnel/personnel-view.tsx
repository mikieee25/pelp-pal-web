'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  ArchiveRounded,
  DeleteOutlineRounded,
  LockResetRounded,
  PersonAddAltRounded,
  RestoreRounded,
} from '@mui/icons-material';
import { getBrowserRepository } from '@/lib/db/browser';
import type { DeviceRecord } from '@/lib/db/records';
import { getLocalSession } from '@/lib/auth/local-session-store';
import {
  createPersonnelClient,
  type CreatePersonnelInput,
  type Personnel,
  type PersonnelClient,
  type PersonnelRole,
} from './personnel-client';

type PersonnelTab = 'active' | 'archived';
type ActionDialog = {
  kind: 'reset' | 'deactivate' | 'archive' | 'restore' | 'delete';
  target: Personnel;
} | null;

const initialForm: CreatePersonnelInput = {
  displayName: '',
  username: '',
  temporaryPassword: '',
  role: 'guest',
};

const roleLabels: Record<PersonnelRole, string> = {
  admin: 'Admin',
  epred: 'EPRED',
  guest: 'Guest',
};

export function PersonnelView() {
  const clientRef = useRef<PersonnelClient | null>(null);
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [tab, setTab] = useState<PersonnelTab>('active');
  const [form, setForm] = useState<CreatePersonnelInput>(initialForm);
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [dialogPassword, setDialogPassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedInUsername, setSignedInUsername] = useState('');

  useEffect(() => {
    let active = true;
    void getBrowserRepository().getDevice().then((current) => {
      if (!active) return;
      setDevice(current ?? null);
      setSignedInUsername(getLocalSession()?.username ?? current?.assignedUsername ?? '');
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Could not verify this browser.');
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const isAdmin = loaded && device?.enrolled === true && device.assignedRole === 'admin' && !device.revokedAt;

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const client = createPersonnelClient();
    clientRef.current = client;
    void client.list(true).then((rows) => {
      if (active) setPersonnel(rows);
    }).catch((reason: unknown) => {
      if (active) setError(toMessage(reason, 'Could not load personnel.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      clientRef.current = null;
    };
  }, [isAdmin]);

  if (!loaded) {
    return <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}><Typography role="status">Loading Personnel…</Typography></Container>;
  }

  if (!isAdmin) {
    return (
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Paper sx={{ p: { xs: 2.5, md: 4 } }}>
          <Alert severity="error" role="alert">Personnel management is available to active administrators only.</Alert>
        </Paper>
      </Container>
    );
  }

  const visiblePersonnel = personnel.filter((person) => tab === 'archived' ? Boolean(person.archivedAt) : !person.archivedAt);
  const currentUsername = signedInUsername.toLowerCase();

  function updateForm<Key extends keyof CreatePersonnelInput>(key: Key, value: CreatePersonnelInput[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function reload() {
    const client = clientRef.current;
    if (!client) return;
    setLoading(true);
    try {
      setPersonnel(await client.list(true));
    } catch (reason) {
      setError(toMessage(reason, 'Could not refresh personnel.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const validationError = validateCreate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    const client = clientRef.current;
    if (!client) return;
    setSaving(true);
    try {
      await client.create({
        displayName: form.displayName.trim(),
        username: form.username.trim().toLowerCase(),
        temporaryPassword: form.temporaryPassword,
        role: form.role,
      });
      setForm(initialForm);
      setNotice('Personnel account added. Share the temporary password securely; it is not shown again here.');
      await reload();
    } catch (reason) {
      setError(toMessage(reason, 'Personnel account creation failed.'));
    } finally {
      setSaving(false);
    }
  }

  function openAction(kind: NonNullable<ActionDialog>['kind'], target: Personnel) {
    setError(null);
    setNotice(null);
    setDialog({ kind, target });
    setDialogPassword('');
    setDeleteConfirmation('');
  }

  async function confirmAction() {
    if (!dialog || !clientRef.current) return;
    setError(null);
    const { kind, target } = dialog;
    if (kind === 'reset' && (dialogPassword.length < 6 || dialogPassword.length > 128)) {
      setError('Enter a temporary password between 6 and 128 characters.');
      return;
    }
    if (kind === 'delete' && deleteConfirmation !== target.username) {
      setError(`Type ${target.username} exactly to confirm permanent deletion.`);
      return;
    }
    setSaving(true);
    try {
      if (kind === 'reset') await clientRef.current.resetPassword(target.id, dialogPassword);
      if (kind === 'deactivate') await clientRef.current.deactivate(target.id);
      if (kind === 'archive') await clientRef.current.archive(target.id);
      if (kind === 'restore') await clientRef.current.restore(target.id);
      if (kind === 'delete') await clientRef.current.delete(target.id, true);
      setDialog(null);
      setDialogPassword('');
      setDeleteConfirmation('');
      setNotice(actionSuccessMessage(kind, target.displayName));
      await reload();
    } catch (reason) {
      setError(toMessage(reason, 'Personnel action failed.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="overline" color="primary.main" fontWeight={800}>ADMINISTRATION</Typography>
        <Typography variant="h3" component="h1">Personnel</Typography>
        <Typography color="text.secondary">Manage organization accounts and access.</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" role="status" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Paper component="form" onSubmit={submitCreate} sx={{ p: { xs: 2, md: 3 }, mb: 2.5 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Add personnel</Typography>
            <Typography variant="body2" color="text.secondary">Create an account with a temporary password. The person must change it after signing in.</Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            <TextField label="Name" value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} />
            <TextField label="Username" value={form.username} onChange={(event) => updateForm('username', event.target.value)} helperText="Lowercase letters, numbers, dots, underscores, and hyphens." />
            <TextField label="Temporary password" type="password" value={form.temporaryPassword} onChange={(event) => updateForm('temporaryPassword', event.target.value)} />
            <FormControl>
              <InputLabel id="personnel-account-type-label">Account type</InputLabel>
              <Select labelId="personnel-account-type-label" label="Account type" value={form.role} onChange={(event) => updateForm('role', event.target.value as PersonnelRole)}>
                <MenuItem value="admin">Admin</MenuItem>
                <MenuItem value="epred">EPRED</MenuItem>
                <MenuItem value="guest">Guest</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" variant="contained" startIcon={<PersonAddAltRounded />} disabled={saving}>
              {saving ? 'Saving…' : 'Add Personnel'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Personnel directory</Typography>
            <Typography variant="body2" color="text.secondary">Active accounts and reversible archived records.</Typography>
          </Box>
          <Tabs value={tab} onChange={(_, value: PersonnelTab) => setTab(value)} variant="fullWidth" aria-label="Personnel status filter">
            <Tab value="active" label="Active" />
            <Tab value="archived" label="Archived" />
          </Tabs>
          {loading && <Typography role="status" color="text.secondary">Loading personnel…</Typography>}
          {!loading && visiblePersonnel.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>{tab === 'active' ? 'No active personnel accounts.' : 'No archived personnel accounts.'}</Typography>}
          <Stack spacing={1.5}>
            {visiblePersonnel.map((person) => (
              <PersonnelCard key={person.id} person={person} currentUsername={currentUsername} onAction={openAction} />
            ))}
          </Stack>
        </Stack>
      </Paper>

      <Dialog open={Boolean(dialog)} onClose={() => !saving && setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>{dialog ? dialogTitle(dialog.kind) : ''}</DialogTitle>
        <DialogContent>
          {dialog && <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>{dialogCopy(dialog.kind, dialog.target.displayName)}</Typography>
            {dialog.kind === 'reset' && <TextField autoFocus fullWidth label="Temporary password" type="password" value={dialogPassword} onChange={(event) => setDialogPassword(event.target.value)} />}
            {dialog.kind === 'delete' && <TextField autoFocus fullWidth label={`Type ${dialog.target.username} to confirm`} value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />}
          </Stack>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void confirmAction()} color={dialog?.kind === 'delete' ? 'error' : 'primary'} variant="contained" disabled={saving}>
            {saving ? 'Saving…' : dialog ? dialogButtonLabel(dialog.kind) : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

function PersonnelCard({ person, currentUsername, onAction }: { person: Personnel; currentUsername: string; onAction: (kind: NonNullable<ActionDialog>['kind'], target: Personnel) => void }) {
  const isSelf = Boolean(currentUsername) && person.username.toLowerCase() === currentUsername;
  const status = person.archivedAt ? 'Archived' : person.isActive ? 'Active' : 'Deactivated';

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.75, md: 2 }, bgcolor: 'background.default' }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={700} noWrap>{person.displayName}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>@{person.username}</Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={roleLabels[person.role]} size="small" variant="outlined" />
            <Chip label={status} size="small" color={status === 'Active' ? 'success' : status === 'Archived' ? 'default' : 'warning'} />
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary">Updated {formatUpdatedAt(person.updatedAt)}</Typography>
        {isSelf ? (
          <Typography variant="body2" color="text.secondary">Your own account cannot be managed from this screen.</Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {status !== 'Archived' && <Button size="small" variant="outlined" startIcon={<LockResetRounded />} onClick={() => onAction('reset', person)}>Reset password</Button>}
            {status === 'Active' && <Button size="small" variant="outlined" onClick={() => onAction('deactivate', person)}>Deactivate</Button>}
            {status !== 'Archived' && <Button size="small" variant="outlined" startIcon={<ArchiveRounded />} onClick={() => onAction('archive', person)}>Archive</Button>}
            {status === 'Archived' && <Button size="small" variant="outlined" startIcon={<RestoreRounded />} onClick={() => onAction('restore', person)}>Restore</Button>}
            <Button size="small" color="error" variant="outlined" startIcon={<DeleteOutlineRounded />} onClick={() => onAction('delete', person)}>Delete</Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function validateCreate(form: CreatePersonnelInput): string | null {
  if (!form.displayName.trim()) return 'Enter a name.';
  if (!/^[a-z0-9._-]{1,80}$/.test(form.username.trim().toLowerCase())) return 'Enter a valid username using lowercase letters, numbers, dots, underscores, or hyphens.';
  if (form.temporaryPassword.length < 6 || form.temporaryPassword.length > 128) return 'Enter a temporary password between 6 and 128 characters.';
  return null;
}

function toMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function formatUpdatedAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'unknown time' : parsed.toLocaleString();
}

function actionSuccessMessage(kind: NonNullable<ActionDialog>['kind'], name: string) {
  if (kind === 'reset') return `Temporary password reset for ${name}.`;
  if (kind === 'deactivate') return `${name} was deactivated.`;
  if (kind === 'archive') return `${name} was archived.`;
  if (kind === 'restore') return `${name} was restored.`;
  return `${name} was permanently deleted.`;
}

function dialogTitle(kind: NonNullable<ActionDialog>['kind']) {
  if (kind === 'reset') return 'Reset password';
  if (kind === 'delete') return 'Delete personnel account';
  if (kind === 'deactivate') return 'Deactivate personnel account';
  if (kind === 'archive') return 'Archive personnel account';
  return 'Restore personnel account';
}

function dialogCopy(kind: NonNullable<ActionDialog>['kind'], name: string) {
  if (kind === 'reset') return `Set a new temporary password for ${name}. It will be required on the next sign-in.`;
  if (kind === 'delete') return `This permanently removes ${name}'s account and Auth identity. Historical inspections and reports are retained.`;
  if (kind === 'deactivate') return `Deactivate ${name}? The account will remain in the directory but cannot sign in.`;
  if (kind === 'archive') return `Archive ${name}? This is reversible and removes the account from the active list.`;
  return `Restore ${name}? The account will return to the active list without changing its password.`;
}

function dialogButtonLabel(kind: NonNullable<ActionDialog>['kind']) {
  if (kind === 'reset') return 'Reset password';
  if (kind === 'delete') return 'Confirm delete';
  if (kind === 'deactivate') return 'Deactivate';
  if (kind === 'archive') return 'Archive';
  return 'Restore';
}
