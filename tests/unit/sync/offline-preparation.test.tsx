import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflinePreparation } from '@/features/sync/offline-preparation';

const mocks = vi.hoisted(() => ({
  getBrowserRepository: vi.fn(),
  getLocalSession: vi.fn(),
  prepareOfflineShell: vi.fn(),
  syncCatalog: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({ getBrowserRepository: () => mocks.getBrowserRepository() }));
vi.mock('@/lib/auth/local-session-store', () => ({ getLocalSession: () => mocks.getLocalSession() }));
vi.mock('@/lib/offline/prepare-shell', () => ({ prepareOfflineShell: () => mocks.prepareOfflineShell() }));
vi.mock('@/features/catalog/catalog-sync', () => ({ syncCatalog: () => mocks.syncCatalog() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('offline preparation', () => {
  it('clears in-progress checks when the full sync fails', async () => {
    mocks.getBrowserRepository.mockReturnValue({ getAccountScope: () => ({ key: 'org-a:account-a' }) });
    mocks.getLocalSession.mockReturnValue({ authUserId: 'auth-a' });
    render(<OfflinePreparation syncNow={vi.fn().mockRejectedValue(new Error('Pull failed'))} />);

    fireEvent.click(screen.getByRole('button', { name: 'Prepare for offline work' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Pull failed'));
    expect(screen.queryByText('Checking catalog saved and verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking app pages and Word template')).not.toBeInTheDocument();
  });
});
