# PELP Pal Web

Separate Next.js/MUI web client for the PELP Pal inspection workflow.

The web client consumes the shared Supabase contract owned by
`C:\Users\mklgr\Codes\pelp_pal_v2`. It does not own Supabase migrations.

## Local development

```powershell
npm install
npm run dev
```

The application shell renders without Supabase configuration. Enrollment and
synchronization require the variables in `.env.example`.
