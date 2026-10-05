import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getDevice = vi.fn();

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({ getDevice }),
}));

import SyncPage from '@/app/(workspace)/sync/page';

describe('SyncPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows that an enrolled browser is ready to sync', async () => {
    getDevice.mockResolvedValue({ enrolled: true });

    render(<SyncPage />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('This browser is enrolled and ready to sync.'));
  });
});
