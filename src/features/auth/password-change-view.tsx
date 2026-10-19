'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sanitizeNextPath } from './workspace-auth-gate';
import { changeCurrentAccountPassword, getCurrentAccount, type CurrentAccount } from './account-password';
import { isValidPassword, passwordLengthMessage } from './password-policy';
import { PasswordField } from '@/components/forms/password-field';
import { stateFeedback } from '@/lib/animation/gsap';
import { InlineNotice } from '@/components/ui';

export function PasswordChangeView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<CurrentAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!error) return undefined;
    return stateFeedback(feedbackRef.current);
  }, [error]);

  useEffect(() => {
    let active = true;
    void getCurrentAccount()
      .then((current) => {
        if (active) setAccount(current);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the signed-in account.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!account) {
      setError('The signed-in account is unavailable.');
      return;
    }
    if (!isValidPassword(newPassword, account.role)) {
      setError(passwordLengthMessage('Choose a password', account.role));
      return;
    }
    if (newPassword !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await changeCurrentAccountPassword(account.id, newPassword);
      router.replace(sanitizeNextPath(searchParams.get('next')));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6 md:py-14">
      <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-xl border border-border bg-white p-5 sm:p-8">
          <div className="text-xs font-bold uppercase tracking-widest text-primary">Account security</div>
          <h1 className="text-2xl font-semibold text-ink">Change your password</h1>
          <p className="text-sm text-muted">
            {loading
              ? 'Checking your account…'
              : `Hello ${account?.displayName ?? account?.username ?? ''}. Your default or temporary password must be changed before you continue.`}
          </p>
          {error && <div ref={feedbackRef}><InlineNotice severity="error">{error}</InlineNotice></div>}
          <PasswordField
            required
            autoFocus
            name="new-password"
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            helperText="Use 6–128 characters."
            disabled={loading || saving}
          />
          <PasswordField
            required
            name="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={loading || saving}
          />
          <button type="submit" className="min-h-11 w-full rounded-control bg-primary px-4 font-semibold text-white disabled:opacity-60" disabled={loading || saving || !account}>
            {saving ? 'Updating password…' : 'Continue'}
          </button>
      </form>
    </main>
  );
}
