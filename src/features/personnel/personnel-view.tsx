'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, KeyRound, MoreVertical, RotateCcw, Trash2, UserPlus, X } from 'lucide-react';
import { getCurrentAccount, type CurrentAccount } from '@/features/auth/account-password';
import { isValidPassword, passwordLengthMessage } from '@/features/auth/password-policy';
import { PasswordField } from '@/components/forms/password-field';
import { ListRow, PageHeader, PageShell, Section, StatusBadge, Surface } from '@/components/ui';
import { AccessibleModal } from '@/components/ui/accessible-overlay';
import { AccessibleSelect } from '@/components/ui/accessible-overlay';
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
  const [account, setAccount] = useState<CurrentAccount>();
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
    void getCurrentAccount().then((current) => {
      if (!active) return;
      setAccount(current);
      setSignedInUsername(current.username);
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Could not verify this account.');
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const isAdmin = loaded && account?.isActive === true && account.role === 'admin';

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
    return <PageShell><PageHeader title="Personnel" /><p role="status" className="text-sm text-muted">Loading Personnel…</p></PageShell>;
  }

  if (!isAdmin) {
    return (
      <PageShell>
        <PageHeader title="Personnel" subtitle="Manage organization accounts and access." />
        <Surface className="mt-6 p-4 sm:p-6">
          <p role="alert" className="text-sm text-danger">Personnel management is available to active administrators only.</p>
        </Surface>
      </PageShell>
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
    if (kind === 'reset' && !isValidPassword(dialogPassword, target.role)) {
      setError(passwordLengthMessage('Enter a temporary password', target.role));
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
    <PageShell>
      <div className="space-y-8">
      <PageHeader title="Personnel" subtitle="Manage organization accounts and access." />

      {error && <InlineFeedback severity="error" message={error} onClose={() => setError(null)} />}
      {notice && <InlineFeedback severity="success" message={notice} onClose={() => setNotice(null)} />}

      <form onSubmit={submitCreate} className="space-y-4">
        <Section title="Add personnel">
          <div className="space-y-4">
          <p className="text-sm text-muted">Create an account with a temporary password. The person must change it after signing in.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium text-ink">Name<input className={inputClass} value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-ink">Username<input aria-label="Username" className={inputClass} value={form.username} onChange={(event) => updateForm('username', event.target.value)} aria-describedby="personnel-username-help" /><span id="personnel-username-help" className="block text-xs font-normal text-muted">Lowercase letters, numbers, dots, underscores, and hyphens.</span></label>
            <PasswordField label="Temporary password" value={form.temporaryPassword} onChange={(event) => updateForm('temporaryPassword', event.target.value)} />
            <AccessibleSelect id="personnel-role" label="Account type" value={form.role} onChange={(value) => updateForm('role', value as PersonnelRole)} options={[{ value: 'admin', label: 'Admin' }, { value: 'epred', label: 'EPRED' }, { value: 'guest', label: 'Guest' }]} />
          </div>
          <div className="flex justify-end"><button type="submit" disabled={saving} className={primaryButton}><UserPlus aria-hidden className="mr-2 size-4" />{saving ? 'Saving…' : 'Add Personnel'}</button></div>
          </div>
        </Section>
      </form>

      <Section title="Personnel directory">
        <div className="space-y-4">
          <p className="text-sm text-muted">Active accounts and reversible archived records.</p>
          <div role="group" aria-label="Personnel status filter" className="grid grid-cols-2 rounded-[10px] border border-border p-1"><button type="button" aria-pressed={tab === 'active'} onClick={() => setTab('active')} className={`min-h-11 rounded-lg text-sm font-semibold ${tab === 'active' ? 'bg-primary-soft text-primary' : 'text-muted'}`}>Active</button><button type="button" aria-pressed={tab === 'archived'} onClick={() => setTab('archived')} className={`min-h-11 rounded-lg text-sm font-semibold ${tab === 'archived' ? 'bg-primary-soft text-primary' : 'text-muted'}`}>Archived</button></div>
          {loading && <p role="status" className="text-sm text-muted">Loading personnel…</p>}
          {!loading && visiblePersonnel.length === 0 && <p className="py-2 text-sm text-muted">{tab === 'active' ? 'No active personnel accounts.' : 'No archived personnel accounts.'}</p>}
          <div className="divide-y divide-border">
            {visiblePersonnel.map((person) => (
              <PersonnelCard key={person.id} person={person} currentUsername={currentUsername} onAction={openAction} />
            ))}
          </div>
        </div>
      </Section>

      {dialog && <AccessibleModal onClose={() => !saving && setDialog(null)} labelledBy="personnel-action-title" dismissable={!saving} className="max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3"><h2 id="personnel-action-title" className="text-lg font-semibold text-ink">{dialogTitle(dialog.kind)}</h2><button type="button" onClick={() => !saving && setDialog(null)} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-surface-alt"><X aria-hidden className="size-5" /></button></div>
          <div className="space-y-4 pt-3">
            <p className="text-sm text-ink">{dialogCopy(dialog.kind, dialog.target.displayName)}</p>
            {dialog.kind === 'reset' && <PasswordField autoFocus label="Temporary password" value={dialogPassword} onChange={(event) => setDialogPassword(event.target.value)} />}
            {dialog.kind === 'delete' && <label className="block space-y-1.5 text-sm font-medium text-ink">Type {dialog.target.username} to confirm<input autoFocus className={inputClass} value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>}
          </div>
          <div className="mt-5 flex flex-col justify-end gap-2 sm:flex-row"><button type="button" onClick={() => setDialog(null)} disabled={saving} className={secondaryButton}>Cancel</button><button type="button" onClick={() => void confirmAction()} disabled={saving} className={dialog.kind === 'delete' ? dangerButton : primaryButton}>{saving ? 'Saving…' : dialogButtonLabel(dialog.kind)}</button></div>
      </AccessibleModal>}
      </div>
    </PageShell>
  );
}

function PersonnelCard({ person, currentUsername, onAction }: { person: Personnel; currentUsername: string; onAction: (kind: NonNullable<ActionDialog>['kind'], target: Personnel) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isSelf = Boolean(currentUsername) && person.username.toLowerCase() === currentUsername;
  const status = person.archivedAt ? 'Archived' : person.isActive ? 'Active' : 'Deactivated';

  return <>
    <ListRow
      primary={person.displayName}
      secondary={`@${person.username} · ${roleLabels[person.role]} · Updated ${formatUpdatedAt(person.updatedAt)}${isSelf ? ' · Your own account cannot be managed from this screen.' : ''}`}
      trailing={<div className="flex items-center gap-2"><StatusBadge variant={status === 'Active' ? 'synced' : status === 'Archived' ? 'neutral' : 'waiting'} label={status} />{!isSelf && <div className="relative"><button type="button" aria-label={`Actions for ${person.displayName}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus"><MoreVertical aria-hidden className="size-5" /></button>{menuOpen && <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-xl border border-border bg-white p-1 shadow-lg">{status !== 'Archived' && <ActionMenuItem icon={<KeyRound />} label="Reset password" onClick={() => { setMenuOpen(false); onAction('reset', person); }} />}{status === 'Active' && <ActionMenuItem label="Deactivate" onClick={() => { setMenuOpen(false); onAction('deactivate', person); }} />}{status !== 'Archived' && <ActionMenuItem icon={<Archive />} label="Archive" onClick={() => { setMenuOpen(false); onAction('archive', person); }} />}{status === 'Archived' && <ActionMenuItem icon={<RotateCcw />} label="Restore" onClick={() => { setMenuOpen(false); onAction('restore', person); }} />}<ActionMenuItem icon={<Trash2 />} label="Delete" onClick={() => { setMenuOpen(false); onAction('delete', person); }} /></div>}</div>}</div>}
    />
  </>;
}

function ActionMenuItem({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" role="menuitem" onClick={onClick} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus">{icon && <span aria-hidden className="text-muted [&>svg]:size-4">{icon}</span>}{label}</button>;
}

function InlineFeedback({ severity, message, onClose }: { severity: 'error' | 'success'; message: string; onClose: () => void }) {
  const tone = severity === 'error' ? 'border-danger bg-danger-soft text-danger' : 'border-success bg-success-soft text-success';
  return <div role={severity === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border-l-4 px-3 py-2.5 text-sm ${tone}`}><span>{message}</span><button type="button" onClick={onClose} aria-label="Dismiss" className="grid size-8 shrink-0 place-items-center rounded hover:bg-white/60"><X aria-hidden className="size-4" /></button></div>;
}

const inputClass = 'min-h-12 w-full rounded-[10px] border border-border-strong bg-white px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-surface-alt';
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-[10px] bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50';
const secondaryButton = 'inline-flex min-h-11 items-center justify-center rounded-[10px] border border-border-strong px-4 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50';
const dangerButton = 'inline-flex min-h-11 items-center justify-center rounded-[10px] bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50';

function validateCreate(form: CreatePersonnelInput): string | null {
  if (!form.displayName.trim()) return 'Enter a name.';
  if (!/^[a-z0-9._-]{1,80}$/.test(form.username.trim().toLowerCase())) return 'Enter a valid username using lowercase letters, numbers, dots, underscores, or hyphens.';
  if (!isValidPassword(form.temporaryPassword, form.role)) return passwordLengthMessage('Enter a temporary password', form.role);
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
