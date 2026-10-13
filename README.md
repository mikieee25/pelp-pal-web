# PELP Pal Web

Separate Next.js/MUI web client for the PELP Pal inspection workflow.

The web client consumes the shared Supabase contract owned by
`C:\Users\mklgr\Codes\pelp_pal_v2`. The current sync identity is the signed-in
Supabase Auth personnel account; device enrollment, enrollment codes, and the
legacy `devices` table are retired from the active product.

## Local development

```powershell
npm install
npm run dev
```

The application shell renders without Supabase configuration. Account
authentication and synchronization require the variables in `.env.example`.

## Synchronization and reports

After signing in, the workspace starts one shared synchronization coordinator.
Use `Sync` → `Sync now` to retry a connection or flush completed inspection
work; local drafts and pending work remain available when offline.

Use `Report` to select all finished stores or one store, enter the EMV report
header and signature details, and download a populated copy of
`public/EMV Report Sample.docx`. Report header fields are saved locally per
finished store. The retained template is never overwritten.
