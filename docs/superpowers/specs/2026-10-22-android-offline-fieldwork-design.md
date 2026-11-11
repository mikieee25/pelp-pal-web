# Android offline fieldwork design

## Goal

Inspectors install an Android APK and open it while connected at DOE. They sign in, prepare the device, then can reopen the app, find catalog products, create and edit inspections, capture photos, and export files without internet during travel. Work syncs through the existing account protocol when connectivity returns.

## Android delivery

Use a Trusted Web Activity (TWA) around the production PWA. This keeps the existing Next.js deployment and account/sync contract. The APK requires a stable HTTPS origin, an Android signing key, and a Digital Asset Links file served from that origin. The signing key stays outside the repository. A new installation must complete online preparation before its first offline trip; clearing browser/site data requires preparation again.

Do not treat the APK wrapper as evidence of offline readiness. The web app proves readiness from the device's own storage and service worker. The APK is distributed only after an Android device passes the offline acceptance test.

## Prepare at DOE

After online sign-in, offer one explicit **Prepare for offline use** action. It completes the normal account-scoped push/pull and role-assigned catalog download, then prepares public application assets and the Word template for offline use. Readiness requires:

- A locally retained, previously verified active account identity and account scope matching the signed-in user.
- A complete local masterlist or guestlist whose row count and integrity hash match the published manifest.
- A successful pull of available inspections and stores, with no unresolved preparation error.
- An installed, controlling service worker and all required public pages, JavaScript, CSS, icons, and the report template cached successfully.

Show the account name, catalog role/version/product count, last successful pull, cache result, and a single **Ready for offline inspections** state. A missing requirement names the failure and offers Retry. Pending local uploads are reported but do not block offline inspection. Downloading remote evidence photos remains opt-in with the existing count/size estimate because devices and Supabase egress are limited.

## Offline execution

On an offline reopen, recover the previously verified account scope from local storage before reading or writing inspections. The cached authorization is local-only: remote operations still require online Supabase authentication, and reconnect revalidates account status. A sign-out clears the local offline identity. Never let an offline account switch write into another account's scope.

Service worker caching stores only public, unauthenticated app-shell HTML and immutable static assets. It must never cache authenticated API responses, user data, or inspection photos. Prepared fixed routes work on a cold offline launch. The dynamic `/inspect/[inspectionId]` server route cannot be requested offline for a new UUID, so offline inspection entry uses a prepared static client route that reads the inspection id and catalog id from its query string. Full-document offline navigation is used where Next.js client navigation would otherwise request uncached server-component data. Direct online `/inspect/[inspectionId]` URLs retain their existing behavior.

Catalog searches, drafts, completion, evidence capture, and queued revisions continue to use IndexedDB. Features that require DOE or Supabase display an offline explanation without blocking local inspection. Returning online resumes the existing sync coordinator.

## Offline exports

The Word report template at `public/EMV Report Sample.docx` is cached and checked during preparation. Word generation uses that local template and local report data. The optional photo appendix includes only images already stored locally; missing photos are reported and skipped. Recovery JSON and individual local evidence downloads use the browser's file handling. Validate that Android saves or shares each file with its expected name and contents while offline. A download failure must be visible rather than reported as success.

## Verification and rollout

Automated production-build tests simulate: online sign-in and preparation; airplane mode; app restart; catalog lookup; creation, draft save, completion, and reopening of an inspection; Word and recovery JSON export; scope isolation; reconnect and upload. Check offline navigation at phone and desktop widths. Test the signed TWA on a physical Android device with Chrome, including camera, file download/share, app force-stop/restart, and airplane mode. Existing web/iOS flows must continue to pass. No production deployment or signing-key generation is part of this implementation without the required production origin and signing details.
