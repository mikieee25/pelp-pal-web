# PELP Pal Web Recovery Guide

PELP Pal Web is the primary inspection workspace. Normal inspections remain available offline and upload through the existing Sync coordinator when the browser is online.

## Transfer pending work

Use JSON recovery only when automatic synchronization is unavailable or a second browser needs a manual handoff.

1. On the source browser, open **Sync**.
2. Select **Pending work** unless a full local backup is required.
3. Choose **Export recovery JSON** to download the file, or **Share recovery JSON** to open the device share sheet.
4. On iOS, use the native share sheet, AirDrop, or Files where available.
5. On Android, use Quick Share, Files, or Downloads where available.
6. On desktop, attach or move the downloaded `.pelp.json` file through an approved channel.
7. On the receiving browser, open **Sync** and choose **Import and merge JSON**.
8. Review the organization, record counts, evidence count, and queued uploads.
9. Select **Merge imported data** only after confirming the preview.
10. Select **Force upload inspections** to send imported pending work through the normal Supabase sync path.

The same UTF-8 `.pelp.json` format is used by iOS, Android, installed PWAs, and desktop browsers. Sharing is optional; download and file selection are the compatibility fallback.

## What import does

- It validates the file before any local write.
- It rejects files from another organization.
- It is idempotent; importing the same file again does not duplicate records.
- It keeps local data when a divergent revision creates a conflict.
- It puts imported pending work into the current browser's normal upload queue.
- It never imports authentication tokens, passwords, browser sessions, or sync cursors.
- It never deletes local inspections automatically.

## Conflicts and failures

If the preview or merge reports conflicts, keep the source file and review the affected inspection in Activity or the inspection editor. Do not delete the local record to make the import pass.

If sharing is canceled, export the file again or use the download option. If upload fails after import, keep the browser open or retry from **Force upload inspections**; the imported work remains local and pending.

The recovery file contains inspection data and may contain evidence images. Even though it contains no credentials, treat it as sensitive and transfer it only through approved channels. Delete temporary copies according to the organization's data-handling policy after successful recovery.
