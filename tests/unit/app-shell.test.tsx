import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDevice: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({ getDevice: mocks.getDevice }),
}));

import { AppShell } from '@/components/app-shell/app-shell';

describe('AppShell', () => {
  beforeEach(() => {
    mocks.getDevice.mockResolvedValue({ enrolled: false });
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

  it('shows Personnel to an enrolled active administrator', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin' });

    render(<AppShell><div>Workspace content</div></AppShell>);

    await waitFor(() => expect(screen.getAllByRole('link', { name: /personnel/i }).length).toBeGreaterThan(0));
  });

  it.each([
    ['EPRED', { enrolled: true, assignedRole: 'epred' }],
    ['Guest', { enrolled: true, assignedRole: 'guest' }],
    ['inactive', { enrolled: true, assignedRole: 'admin', revokedAt: '2026-10-06T00:00:00Z' }],
    ['unenrolled', { enrolled: false, assignedRole: 'admin' }],
  ])('does not show Personnel to %s devices', async (_label, device) => {
    mocks.getDevice.mockResolvedValue(device);

    render(<AppShell><div>Workspace content</div></AppShell>);

    await waitFor(() => expect(mocks.getDevice).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /personnel/i })).not.toBeInTheDocument();
  });
});
