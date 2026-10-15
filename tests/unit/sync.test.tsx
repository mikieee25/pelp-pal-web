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
    expect(screen.getByTestId('sync-details-accordion').querySelector('[aria-expanded="false"]')).toBeInTheDocument();
    expect(screen.getByTestId('sync-advanced-accordion').querySelector('[aria-expanded="false"]')).toBeInTheDocument();
  });
});
