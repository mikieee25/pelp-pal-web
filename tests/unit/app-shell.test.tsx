import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentAccount = vi.hoisted(() => vi.fn());
const syncSnapshot = vi.hoisted(() => ({ status: 'live', pendingCount: 0, conflictCount: 0, failedCount: 0, realtimeState: 'connected' }));
const syncStore = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => undefined),
  getSnapshot: vi.fn(() => syncSnapshot),
}));
vi.mock('@/features/auth/account-password', () => ({ getCurrentAccount }));
vi.mock('@/features/sync/sync-runtime-boundary', () => ({ useSyncRuntimeStatusStore: () => syncStore }));
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

  it('renders the desktop sync status below the brand row', () => {
    render(<AppShell><div>Workspace content</div></AppShell>);

    const drawerStatus = screen.getByTestId('drawer-sync-status');
    const desktopBrand = screen.getAllByText('PELP Pal')[1].parentElement?.parentElement;

    expect(drawerStatus.previousElementSibling).toBe(desktopBrand);
    expect(drawerStatus).toContainElement(screen.getAllByTestId('sync-status-pill')[1]);
  });

  it('renders brand captions as block-level elements', () => {
    render(<AppShell><div>Workspace content</div></AppShell>);

    expect(screen.getAllByText('Inspection workspace').every((element) => element.tagName === 'DIV')).toBe(true);
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
