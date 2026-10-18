'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sanitizeNextPath } from '@/features/auth/workspace-auth-gate';
import { signInWithCredentials } from '@/lib/auth/local-session';
import { saveLocalSession } from '@/lib/auth/local-session-store';
import { PasswordField } from '@/components/forms/password-field';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { ActionBar, InlineNotice, PageHeader, PageShell, Section } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <AnimatedRoute>
      <main><PageShell>
        <div className="space-y-6">
          <PageHeader title="Sign in" subtitle="Use your PELP Pal personnel username and password." />
          <form onSubmit={async (event) => {
        event.preventDefault();
        if (isSubmitting) return;

        setMessage(undefined);
        setIsSubmitting(true);
        const form = new FormData(event.currentTarget);
        const username = String(form.get('username') ?? '');
        const password = String(form.get('password') ?? '');
        try {
          const account = await signInWithCredentials(username, password);
          saveLocalSession(account.username);
          const nextPath = sanitizeNextPath(searchParams.get('next'));
          router.replace(
            account.must_change_password
              ? `/change-password?next=${encodeURIComponent(nextPath)}`
              : nextPath,
          );
        } catch {
          setMessage('Invalid credentials or unavailable sign-in service.');
        } finally {
          setIsSubmitting(false);
        }
          }} className="space-y-6">
              <Section title="Account access">
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-ink">Username<input className="mt-1.5 h-12 w-full rounded-control border border-border-strong bg-white px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-focus" required name="username" autoComplete="username" /></label>
                  <PasswordField fullWidth required name="password" label="Password" autoComplete="current-password" />
                  {message && <InlineNotice severity="info">{message}</InlineNotice>}
                </div>
              </Section>
              <ActionBar>
                <button type="submit" disabled={isSubmitting} className="min-h-11 w-full rounded-control bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60">
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </button>
              </ActionBar>
          </form>
        </div>
      </PageShell></main>
    </AnimatedRoute>
  );
}
