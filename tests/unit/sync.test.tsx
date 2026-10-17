import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SyncPage from '@/app/(workspace)/sync/page';

describe('SyncPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the simplified sync status and keeps operational details collapsed', () => {
    render(<SyncPage />);
    expect(screen.getByTestId('sync-headline')).toHaveTextContent('Everything is up to date');
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
  });
});
