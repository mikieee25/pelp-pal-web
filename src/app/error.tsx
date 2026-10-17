'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-col items-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-sm text-muted">Your local work was not cleared.</p>
      <button type="button" onClick={reset} className="min-h-11 rounded-control bg-primary px-4 font-semibold text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Try again</button>
    </main>
  );
}
