'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { CameraAltRounded } from '@mui/icons-material';
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
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="scan-energy-label-title"
    >
      <DialogTitle id="scan-energy-label-title">Scan energy label</DialogTitle>
      <DialogContent ref={dialogContentRef}>
        <Stack spacing={2}>
          <Typography color="text.secondary">
            Point your camera at the QR code on the energy label. The control number will be used to search this device.
          </Typography>
          <Box
            data-testid="qr-camera-frame"
            data-aspect-ratio="1:1"
            sx={{
              width: '100%',
              aspectRatio: '1 / 1',
              overflow: 'hidden',
              borderRadius: 1.5,
              bgcolor: 'common.black',
              position: 'relative',
            }}
          >
            <Box
              component="video"
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="QR scanner camera preview"
              onLoadedMetadata={() => setCameraReady(true)}
              sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', bgcolor: 'grey.900' }}
            />
            {!cameraReady && !cameraError && <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ position: 'absolute', inset: 0, color: 'common.white', bgcolor: 'rgba(15, 23, 42, 0.82)' }}>
              <CircularProgress color="inherit" size={28} />
              <Typography variant="body2">Opening camera…</Typography>
            </Stack>}
            {cameraError && <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ position: 'absolute', inset: 0, px: 3, textAlign: 'center', color: 'common.white', bgcolor: 'rgba(15, 23, 42, 0.92)' }}>
              <CameraAltRounded />
              <Typography variant="body2">Camera preview unavailable</Typography>
              <Typography variant="caption">Use manual catalog search below.</Typography>
            </Stack>}
            {!cameraError && <Box aria-hidden="true" sx={{ position: 'absolute', inset: '18%', border: '2px solid', borderColor: 'primary.light', borderRadius: 2, boxShadow: '0 0 0 999px rgba(15, 23, 42, 0.18)' }} />}
          </Box>
          {cameraError ? <Alert severity="warning">{cameraError}</Alert> : null}
          <Typography variant="body2" color="text.secondary">
            Camera scanning is optional. You can always enter the control number manually.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function isRetryableCameraError(error: unknown): boolean {
  return error instanceof DOMException
    ? ['OverconstrainedError', 'NotFoundError', 'TypeError'].includes(error.name)
    : error instanceof Error && ['OverconstrainedError', 'NotFoundError', 'TypeError'].includes(error.name);
}
