import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = vi.fn().mockRejectedValue(Object.assign(new Error('unsupported camera constraint'), { name: 'OverconstrainedError' }));
    decodeFromConstraints = vi.fn().mockRejectedValue(new Error('camera unavailable'));
  },
}));

import { QrScannerDialog } from '@/features/lookup/qr-scanner-dialog';

describe('QrScannerDialog', () => {
  afterEach(() => cleanup());

  it('shows a useful camera state instead of an unexplained black preview', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
    render(<QrScannerDialog open onClose={vi.fn()} onDetected={vi.fn()} />);

    expect(screen.getByTestId('qr-camera-frame')).toHaveAttribute('data-aspect-ratio', '1:1');
    expect(await screen.findByText(/camera access is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/camera preview unavailable/i)).toBeInTheDocument();
  });
});
