# Android offline fieldwork

## Inspector workflow

1. Install the APK while online and open it at DOE.
2. Sign in, open **Sync**, and choose **Prepare for offline work**. Wait until the account, catalog, app shell, and Word template checks all report ready.
3. Before travel, confirm the correct account and catalog are shown. Pending changes are stored on this device and upload after connectivity returns.
4. In the field, use the app normally. Keep photos local unless they are needed offline; remote-photo downloads remain opt-in to limit data use.
5. Export Word or Recovery JSON while offline as needed. After returning online, open **Sync** and run **Sync now**.

Preparation is per browser profile/device. Clearing site data, reinstalling Chrome, or signing out removes the local readiness state. A TWA uses Chrome's browser storage; installing the APK alone does not pre-populate the catalog or account. Do not clear app/site storage during an inspection trip.

## Current readiness and remaining release gates

The production origin is `https://pelppal-web.vercel.app`. Its manifest responds over HTTPS, but currently advertises only `/icons/Energi.png` at `1231x1277`; it does not advertise the conventional square 192px and 512px PNG icons expected for a polished installable Android PWA. The production `/.well-known/assetlinks.json` currently returns 404. Therefore a verified full-screen TWA APK is not yet release-ready. The app's offline workflow has a production-browser test, but physical Android airplane-mode, camera, and file-save/share behavior still needs device acceptance testing.

The approved Android application id is `ph.gov.doe.pelppal`. The generated TWA project is in `android-twa/`; its current unsigned build is a test artifact only. A release build must use an organization-owned keystore kept outside this repository and must be paired with the matching Digital Asset Links fingerprint.

Trusted Web Activity verification requires the website's Digital Asset Links file to name the Android package and match the installed APK's signing-certificate SHA-256 fingerprint. Until that association is served by the production origin, Chrome may show browser UI around the app. The package id and release keystore must be chosen and retained securely before publishing; never commit the keystore or passwords.

## Build preparation

The build workstation currently has Android SDK platforms/build-tools, `adb`, JDK 17, and `keytool`. The checked-in Android project targets API 24 because the generated Android Browser Helper dependency requires it. From PowerShell, after adding square 192px/512px icons to the web manifest:

```powershell
$env:JAVA_HOME = 'C:\Android_DevTools\jdk-17'
$env:ANDROID_HOME = 'C:\Android_DevTools\Android\sdk'
Set-Location android-twa
.\gradlew.bat assembleRelease
```

The unsigned test APK is written to `android-twa/app/build/outputs/apk/release/app-release-unsigned.apk`. Review the generated `twa-manifest.json` before building. Create/backup the release keystore outside the repository using the organization's approved secret-storage process, then configure the release signing step with that key. Do not use a debug key for distributed APKs. Publish the generated Digital Asset Links JSON at `https://pelppal-web.vercel.app/.well-known/assetlinks.json` only after the package id and release signing fingerprint have been finalized and approved. Bubblewrap's generated Android project can also be opened in Android Studio.

For local phone testing only, the debug build is signed with the workstation's debug key and is written to `android-twa/app/build/outputs/apk/debug/app-debug.apk`. With USB debugging enabled and an authorized device connected, install it with:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\debug\app-debug.apk
```

No Android device was connected during this build, so install-and-airplane-mode acceptance remains outstanding.

For a Bubblewrap rebuild from the generated project, use `npx --yes @bubblewrap/cli build --skipSigning --manifest=twa-manifest.json` from `android-twa`. `--skipSigning` is for local validation only; it must not be used for the APK distributed to inspectors.

## Physical-device acceptance

On the exact APK intended for inspectors:

1. Install with network access, sign in, and prepare offline work until all checks are ready.
2. Force-stop the app, enable airplane mode, and reopen it from the launcher.
3. Search the downloaded catalog, create/edit/complete an inspection, capture a photo, and verify it persists after another force-stop/reopen.
4. Export a Word report and Recovery JSON. Check that Android saves/shares files with the expected names and contents.
5. Restore connectivity, sync, and confirm the inspection and evidence arrive on the intended account.

The browser automation simulates network loss and reloads in Chromium; it is not a substitute for this Android device test.

## Web verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```
