import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import { signInWithCredentials } from '@/lib/auth/local-session';
import { saveLocalSession } from '@/lib/auth/local-session-store';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@/lib/auth/local-session', () => ({
  signInWithCredentials: vi.fn(),
}));

vi.mock('@/lib/auth/local-session-store', () => ({
  saveLocalSession: vi.fn(),
}));

describe('LoginPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    replace.mockReset();
    vi.mocked(signInWithCredentials).mockResolvedValue({
      id: 'account-1',
      organization_id: 'org-1',
      username: 'epred-1',
      display_name: 'EPRED 1',
      role: 'inspector',
      is_active: true,
      credential_version: 1,
      must_change_password: false,
    });
  });

  it('redirects to the dashboard after signing in', async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByRole('textbox', { name: /username/i }), { target: { value: 'epred-1' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(saveLocalSession).toHaveBeenCalledWith('epred-1');
  });

  it('stays on the login form when credentials are rejected', async () => {
    vi.mocked(signInWithCredentials).mockRejectedValueOnce(new Error('Invalid credentials.'));
    render(<LoginPage />);

    fireEvent.change(screen.getByRole('textbox', { name: /username/i }), { target: { value: 'epred-1' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid credentials/i));
    expect(replace).not.toHaveBeenCalled();
    expect(saveLocalSession).not.toHaveBeenCalled();
  });
});
