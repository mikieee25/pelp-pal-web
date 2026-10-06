import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  DeviceAlreadyEnrolledError: class DeviceAlreadyEnrolledError extends Error {},
  enrollBrowserDevice: vi.fn(),
  getBrowserRepository: vi.fn(),
  getSupabaseBrowserClient: vi.fn(),
  replace: vi.fn(),
  repository: {
    getOrCreateInstallationId: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => '/enroll',
}));

vi.mock('@/features/enrollment/enrollment-client', () => ({
  DeviceAlreadyEnrolledError: mocks.DeviceAlreadyEnrolledError,
  enrollBrowserDevice: mocks.enrollBrowserDevice,
}));

vi.mock('@/lib/config/app-version', () => ({ APP_VERSION: '0.1.0' }));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: mocks.getBrowserRepository,
}));

vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: mocks.getSupabaseBrowserClient,
}));

import EnrollPage from '@/app/enroll/page';

describe('EnrollPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBrowserRepository.mockReturnValue(mocks.repository);
    mocks.getSupabaseBrowserClient.mockReturnValue({});
    mocks.repository.getOrCreateInstallationId.mockResolvedValue('installation-1');
    mocks.enrollBrowserDevice.mockResolvedValue({
      organization_id: 'org-1',
      assigned_username: 'sample',
      assigned_role: 'admin',
      catalog_scope: 'masterlist',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('redirects to the home screen after successful enrollment', async () => {
    render(<EnrollPage />);

    fireEvent.change(screen.getByLabelText(/enrollment code/i), { target: { value: '404487' } });
    fireEvent.submit(screen.getByRole('button', { name: /continue/i }).closest('form')!);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login'));
  });

  it('prevents duplicate enrollment submissions while the request is pending', async () => {
    let resolveEnrollment!: (value: unknown) => void;
    mocks.enrollBrowserDevice.mockReturnValueOnce(new Promise((resolve) => {
      resolveEnrollment = resolve;
    }));

    render(<EnrollPage />);

    fireEvent.change(screen.getByLabelText(/enrollment code/i), { target: { value: '404487' } });
    const form = screen.getByRole('button', { name: /continue/i }).closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole('button', { name: /enrolling/i })).toBeDisabled());
    fireEvent.submit(form);
    expect(mocks.enrollBrowserDevice).toHaveBeenCalledTimes(1);

    resolveEnrollment({
      organization_id: 'org-1',
      assigned_username: 'sample',
      assigned_role: 'admin',
      catalog_scope: 'masterlist',
    });
  });

  it('shows a friendly already-enrolled message and redirects home', async () => {
    vi.useFakeTimers();
    mocks.enrollBrowserDevice.mockRejectedValueOnce(new mocks.DeviceAlreadyEnrolledError('Browser is already enrolled.'));

    render(<EnrollPage />);

    fireEvent.change(screen.getByLabelText(/enrollment code/i), { target: { value: '404487' } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /continue/i }).closest('form')!);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Browser is already enrolled. Redirecting you to sign in…');
    vi.advanceTimersByTime(800);
    expect(mocks.replace).toHaveBeenCalledWith('/login');
  });
});
