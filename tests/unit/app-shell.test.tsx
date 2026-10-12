import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentAccount = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/account-password', () => ({ getCurrentAccount }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

import { AppShell } from '@/components/app-shell/app-shell';

describe('AppShell', () => {
  beforeEach(() => {
    getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', username: 'epred.one', role: 'epred', isActive: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('provides a responsive workspace menu for secondary destinations', () => {
    render(<AppShell><div>Workspace content</div></AppShell>);
    expect(screen.getByRole('button', { name: /open workspace menu/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /account/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /sync/i }).length).toBeGreaterThan(0);
    expect(screen.getByText('Workspace content')).toBeInTheDocument();
  });

  it('shows Personnel to an active administrator account', async () => {
    getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', username: 'admin', role: 'admin', isActive: true });
    render(<AppShell><div>Workspace content</div></AppShell>);
    await waitFor(() => expect(screen.getAllByRole('link', { name: /personnel/i }).length).toBeGreaterThan(0));
  });

  it.each([
    ['EPRED', { role: 'epred', isActive: true }],
    ['Guest', { role: 'guest', isActive: true }],
    ['inactive', { role: 'admin', isActive: false }],
  ])('does not show Personnel to %s accounts', async (_label, account) => {
    getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', username: 'user', ...account });
    render(<AppShell><div>Workspace content</div></AppShell>);
    await waitFor(() => expect(getCurrentAccount).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /personnel/i })).not.toBeInTheDocument();
  });
});
