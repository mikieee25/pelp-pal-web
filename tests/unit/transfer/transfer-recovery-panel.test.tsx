import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransferRecoveryPanel } from '@/features/sync/transfer-recovery-panel';
import type { TransferBundle } from '@/lib/transfer/transfer-codec';

afterEach(cleanup);

const bundle: TransferBundle = {
  format: 'pelp-pal-transfer',
  schemaVersion: 1,
  exportMode: 'pending',
  exportedAt: '2026-10-12T08:00:00.000Z',
  appVersion: '0.1.0',
  organizationId: 'org-1',
  records: { inspections: [{ id: 'inspection-1' }], revisions: [], activities: [], evidence: [], evidenceBlobs: [], outbox: [{ id: 'outbox-1', aggregateId: 'inspection-1' }] },
};

function recoveryFile(): File {
  const text = JSON.stringify(bundle);
  const file = new File([text], 'recovery.pelp.json', { type: 'application/json' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer });
  return file;
}

function setup() {
  const repository = {
    exportTransferBundle: vi.fn().mockResolvedValue(bundle),
    listTransferStores: vi.fn().mockResolvedValue([
      { key: 'store:air-king', name: 'Air King Air Conditioning', location: 'Mindanao', inspectionCount: 3 },
      { key: 'store:sample', name: 'Sample Store', location: 'Luzon', inspectionCount: 1 },
    ]),
    previewTransferMerge: vi.fn().mockResolvedValue({ exportMode: 'pending', organizationId: 'org-1', fileSize: 10, inspectionCount: 1, revisionCount: 0, activityCount: 0, evidenceCount: 0, evidenceBytes: 0, outboxCount: 1, importedCount: 1, skippedCount: 0, conflictCount: 0, duplicateEvidenceCount: 0 }),
    mergeTransferBundle: vi.fn().mockResolvedValue({ importedCount: 1, skippedCount: 0, conflictCount: 0, duplicateEvidenceCount: 0, completedAt: '2026-10-12T08:00:00.000Z' }),
  };
  const statusStore = { syncNow: vi.fn().mockResolvedValue(undefined) };
  render(<TransferRecoveryPanel repository={repository} statusStore={statusStore} />);
  return { repository, statusStore };
}

describe('TransferRecoveryPanel', () => {
  it('previews an import before merging it', async () => {
    const { repository, statusStore } = setup();
    const input = screen.getByLabelText(/import and merge json/i);
    fireEvent.change(input, { target: { files: [recoveryFile()] } });

    expect(await screen.findByText('Review import')).toBeInTheDocument();
    expect(repository.mergeTransferBundle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Merge imported data' }));

    await waitFor(() => expect(repository.mergeTransferBundle).toHaveBeenCalledTimes(1));
    expect(statusStore.syncNow).toHaveBeenCalledWith('manual', 'upload');
  });

  it('leaves the repository unchanged when import is canceled', async () => {
    const { repository } = setup();
    fireEvent.change(screen.getByLabelText(/import and merge json/i), { target: { files: [recoveryFile()] } });
    expect(await screen.findByText('Review import')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(repository.mergeTransferBundle).not.toHaveBeenCalled();
  });

  it('exports pending work for the selected stores', async () => {
    const { repository } = setup();
    const select = await screen.findByRole('combobox', { name: 'Stores to export' });
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: /Sample Store/i }));
    fireEvent.keyDown(document.activeElement ?? select, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Export recovery JSON' }));

    await waitFor(() => expect(repository.exportTransferBundle).toHaveBeenCalledWith('pending', ['store:sample']));
  });
});
