'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { Camera } from 'lucide-react';
import { InlineNotice } from '@/components/ui';
import { slidePanel } from '@/lib/animation/gsap';

type QrScannerDialogProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (payload: string) => void;
};

export function QrScannerDialog({ open, onClose, onDetected }: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const animationCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      animationCleanupRef.current = slidePanel(dialogContentRef.current, 'right');
    });

    return () => {
      window.cancelAnimationFrame(frame);
      animationCleanupRef.current?.();
      animationCleanupRef.current = undefined;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let active = true;
    let controls: { stop: () => void } | undefined;
    let startTimer: number | undefined;

    const startScanner = () => {
      if (!active) return;
      const video = videoRef.current;
      if (!video) {
        startTimer = window.setTimeout(startScanner, 50);
        return;
      }
      if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access requires HTTPS and a browser camera permission. Use manual search if camera access is unavailable.');
        return;
      }
      setCameraError(null);
      setCameraReady(false);
      const reader = new BrowserQRCodeReader();
      const onScanResult = (result: { getText: () => string } | undefined) => {
        if (active && result) onDetected(result.getText());
      };
      const startDecoding = async () => {
        let lastError: unknown;
        const attempts = [
          () => reader.decodeFromVideoDevice(undefined, video, onScanResult),
          () => reader.decodeFromConstraints({ audio: false, video: true }, video, onScanResult),
        ];
        for (let index = 0; index < attempts.length; index += 1) {
          try {
            return await attempts[index]();
          } catch (error) {
            lastError = error;
            if (index === attempts.length - 1 || !isRetryableCameraError(error)) throw error;
          }
        }
        throw lastError;
      };
      void startDecoding().then((nextControls) => {
        if (active) {
          controls = nextControls;
          setCameraReady(true);
        } else {
          nextControls.stop();
        }
      }).catch(() => {
        if (active) {
          setCameraReady(false);
          setCameraError('Camera access is unavailable. Allow camera permission in your browser settings or use manual search.');
        }
      });
    };
    startTimer = window.setTimeout(startScanner, 0);

    return () => {
      active = false;
      if (startTimer !== undefined) window.clearTimeout(startTimer);
      controls?.stop();
    };
  }, [onDetected, open]);

  return (
    !open ? null : <div className="fixed inset-0 z-[100] grid place-items-center bg-ink/60 p-3" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="scan-energy-label-title" className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
      <h2 id="scan-energy-label-title" className="px-5 pt-5 text-lg font-semibold text-ink">Scan energy label</h2>
      <div ref={dialogContentRef} className="space-y-4 p-5">
          <p className="text-sm text-muted">
            Point your camera at the QR code on the energy label. The control number will be used to search this device.
          </p>
          <div data-testid="qr-camera-frame" data-aspect-ratio="1:1" className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="QR scanner camera preview"
              onLoadedMetadata={() => setCameraReady(true)}
              className="block size-full bg-neutral-900 object-cover"
            />
            {!cameraReady && !cameraError && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/80 text-white"><span role="progressbar" aria-label="Opening camera" className="size-7 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" /><span className="text-sm">Opening camera…</span></div>}
            {cameraError && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/90 px-6 text-center text-white"><Camera aria-hidden="true" /><span className="text-sm">Camera preview unavailable</span><span className="text-xs">Use manual catalog search below.</span></div>}
            {!cameraError && <div aria-hidden="true" className="absolute inset-[18%] rounded-xl border-2 border-primary shadow-[0_0_0_999px_rgba(15,23,42,0.18)]" />}
          </div>
          {cameraError ? <InlineNotice severity="warning">{cameraError}</InlineNotice> : null}
          <p className="text-sm text-muted">
            Camera scanning is optional. You can always enter the control number manually.
          </p>
      </div>
      <div className="flex justify-end border-t border-border p-4"><button type="button" onClick={onClose} className="min-h-11 rounded-control border border-border-strong px-4 font-semibold text-ink">Close</button></div>
      </section>
    </div>
  );
}

function isRetryableCameraError(error: unknown): boolean {
  return error instanceof DOMException
    ? ['OverconstrainedError', 'NotFoundError', 'TypeError'].includes(error.name)
    : error instanceof Error && ['OverconstrainedError', 'NotFoundError', 'TypeError'].includes(error.name);
}
