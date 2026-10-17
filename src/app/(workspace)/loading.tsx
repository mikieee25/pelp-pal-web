export default function WorkspaceLoading() {
  return (
    <main role="status" aria-label="Loading workspace" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 md:py-10">
      <div className="space-y-2"><div className="h-6 w-32 animate-pulse rounded bg-surface-alt" /><div className="h-12 w-4/5 max-w-[420px] animate-pulse rounded bg-surface-alt" /><div className="h-7 w-[92%] max-w-[560px] animate-pulse rounded bg-surface-alt" /></div>
      <div className="space-y-4 rounded-xl border border-border bg-white p-4 sm:p-6"><div className="h-[72px] animate-pulse rounded-lg bg-surface-alt" /><div className="h-[148px] animate-pulse rounded-lg bg-surface-alt" /><div className="h-[148px] animate-pulse rounded-lg bg-surface-alt" /></div>
    </main>
  );
}
