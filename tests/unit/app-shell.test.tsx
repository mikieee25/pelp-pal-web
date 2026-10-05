import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

import { AppShell } from '@/components/app-shell/app-shell';

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('provides a responsive workspace menu for secondary destinations', () => {
    render(<AppShell><div>Workspace content</div></AppShell>);

    expect(screen.getByRole('button', { name: /open workspace menu/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /account/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /sync/i }).length).toBeGreaterThan(0);
    expect(screen.getByText('Workspace content')).toBeInTheDocument();
  });
});
