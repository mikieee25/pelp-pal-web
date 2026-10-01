import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/components/app-shell/app-shell';

describe('AppShell', () => {
  it('exposes the primary workspace navigation', () => {
    render(<AppShell><p>content</p></AppShell>);
    const navigation = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(within(navigation).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(within(navigation).getByRole('link', { name: 'Lookup' })).toHaveAttribute('href', '/lookup');
    expect(within(navigation).getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/activity');
    expect(within(navigation).getByRole('link', { name: 'Summary' })).toHaveAttribute('href', '/summary');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
