# Recover PELP Pal evidence from Android

Requirements: Node.js 22+, Android platform-tools (`adb`), an unlocked phone with USB debugging approved, and PELP Pal open in the browser profile(s) to inspect.

From the repository root, run:

```powershell
node .\scripts\adb-recover-evidence.mjs
```

The script lists installed browser packages and reachable Android DevTools sockets, checks open tabs on those sockets for the PELP host, then asks for the evidence photo IDs. It copies matching blobs from the existing PELP IndexedDB to a timestamped folder under `Downloads\PELP-evidence-recovery-*`. The phone's browser data is opened read-only; ADB forwards are removed when the run ends. Each exported image gets a SHA-256 checksum in the console.

Open PELP Pal in each browser before running. A browser is inspectable only when it exposes a reachable DevTools socket; installed browsers without one are reported as installed but their private site data cannot be checked. Enter the exact evidence IDs shown by PELP. The script does not export all photos by default, alter sync state, or delete anything.

If an ID is not found, its image blob is not present in any inspected browser profile. An evidence metadata row alone cannot recreate the original image.
