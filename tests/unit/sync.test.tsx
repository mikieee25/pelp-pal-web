import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SyncPage from '@/app/(workspace)/sync/page';

describe('SyncPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('explains account-based sync access', () => {
    render(<SyncPage />);
    expect(screen.getByText(/sign in with an active personnel account/i)).toBeInTheDocument();
  });
});
