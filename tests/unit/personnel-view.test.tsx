import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDevice: vi.fn(),
  createPersonnelClient: vi.fn(),
  getLocalSession: vi.fn(),
}));

vi.mock('@/lib/db/browser', () => ({
  getBrowserRepository: () => ({ getDevice: mocks.getDevice }),
}));

vi.mock('@/lib/auth/local-session-store', () => ({
  getLocalSession: mocks.getLocalSession,
}));

vi.mock('@/features/personnel/personnel-client', () => ({
  createPersonnelClient: mocks.createPersonnelClient,
}));

import { PersonnelView } from '@/features/personnel/personnel-view';

const activePersonnel = {
  id: 'person-1', organizationId: 'org-1', username: 'epred.one', displayName: 'EPRED One', role: 'epred' as const,
  isActive: true, archivedAt: null, archivedBy: null, mustChangePassword: true, updatedAt: '2026-10-06T00:00:00Z',
};

const archivedPersonnel = {
  id: 'person-2', organizationId: 'org-1', username: 'guest.one', displayName: 'Guest One', role: 'guest' as const,
  isActive: false, archivedAt: '2026-10-05T00:00:00Z', archivedBy: 'admin-id', mustChangePassword: false, updatedAt: '2026-10-06T00:00:00Z',
};

describe('PersonnelView access boundary', () => {
  beforeEach(() => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'epred' });
    mocks.getLocalSession.mockReturnValue({ username: 'epred.one' });
    mocks.createPersonnelClient.mockReturnValue({ list: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows an authorization message and no management controls to non-admins', async () => {
    render(<PersonnelView />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/active administrators only/i));
    expect(screen.queryByRole('button', { name: /add personnel/i })).not.toBeInTheDocument();
    expect(mocks.createPersonnelClient).not.toHaveBeenCalled();
  });

  it('renders the Personnel heading for an enrolled administrator', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin' });
    mocks.getLocalSession.mockReturnValue({ username: 'admin' });
    mocks.createPersonnelClient.mockReturnValue({ list: vi.fn().mockResolvedValue([]) });

    render(<PersonnelView />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Personnel' })).toBeInTheDocument());
  });

  it('shows the active directory, account fields, and lifecycle actions', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin' });
    mocks.getLocalSession.mockReturnValue({ username: 'admin' });
    mocks.createPersonnelClient.mockReturnValue({
      list: vi.fn().mockResolvedValue([activePersonnel, archivedPersonnel]),
      create: vi.fn(), resetPassword: vi.fn(), deactivate: vi.fn(), archive: vi.fn(), restore: vi.fn(), delete: vi.fn(),
    });

    render(<PersonnelView />);

    await waitFor(() => expect(screen.getByText('EPRED One')).toBeInTheDocument());
    expect(screen.getByText('@epred.one')).toBeInTheDocument();
    expect(screen.getByText('EPRED')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument();
    expect(screen.queryByText('Guest One')).not.toBeInTheDocument();
  });

  it('switches to archived personnel without horizontal-only content', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin' });
    mocks.getLocalSession.mockReturnValue({ username: 'admin' });
    mocks.createPersonnelClient.mockReturnValue({
      list: vi.fn().mockResolvedValue([activePersonnel, archivedPersonnel]),
      create: vi.fn(), resetPassword: vi.fn(), deactivate: vi.fn(), archive: vi.fn(), restore: vi.fn(), delete: vi.fn(),
    });

    render(<PersonnelView />);
    await waitFor(() => expect(screen.getByText('EPRED One')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /archived/i }));

    expect(screen.getByText('Guest One')).toBeInTheDocument();
    expect(screen.queryByText('EPRED One')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  it('validates and submits the add-personnel form without retaining the password', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin' });
    mocks.getLocalSession.mockReturnValue({ username: 'admin' });
    const create = vi.fn().mockResolvedValue(activePersonnel);
    const list = vi.fn().mockResolvedValue([]);
    mocks.createPersonnelClient.mockReturnValue({
      list, create, resetPassword: vi.fn(), deactivate: vi.fn(), archive: vi.fn(), restore: vi.fn(), delete: vi.fn(),
    });

    render(<PersonnelView />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add personnel/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add personnel/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a name/i);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Guest' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new.guest' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /add personnel/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      displayName: 'New Guest', username: 'new.guest', temporaryPassword: 'secret123', role: 'guest',
    }));
    expect(screen.getByLabelText('Temporary password')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent(/added/i);
  });

  it('requires confirmation before deleting a personnel account', async () => {
    mocks.getDevice.mockResolvedValue({ enrolled: true, assignedRole: 'admin' });
    mocks.getLocalSession.mockReturnValue({ username: 'admin' });
    const deletePersonnel = vi.fn().mockResolvedValue(undefined);
    mocks.createPersonnelClient.mockReturnValue({
      list: vi.fn().mockResolvedValue([activePersonnel]),
      create: vi.fn(), resetPassword: vi.fn(), deactivate: vi.fn(), archive: vi.fn(), restore: vi.fn(), delete: deletePersonnel,
    });

    render(<PersonnelView />);
    await waitFor(() => expect(screen.getByText('EPRED One')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/permanent/i);
    expect(deletePersonnel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/type epred.one to confirm/i), { target: { value: 'epred.one' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => expect(deletePersonnel).toHaveBeenCalledWith('person-1', true));
  });
});
