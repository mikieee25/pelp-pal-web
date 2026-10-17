import type { ReactNode } from 'react';

export function PageContainer({ children, maxWidth = 'lg' }: { children: ReactNode; maxWidth?: 'md' | 'lg' | 'xl' }) {
  const width = maxWidth === 'md' ? 'max-w-3xl' : maxWidth === 'xl' ? 'max-w-7xl' : 'max-w-6xl';
  return <div className={`mx-auto w-full min-w-0 ${width} px-4 py-6 sm:px-6 md:py-10`}>{children}</div>;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return <header className="mb-6 flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start md:mb-8">
    <div className="min-w-0"><div className="mb-1 text-xs font-bold uppercase tracking-widest text-primary">{eyebrow}</div><h1 className="text-display font-semibold leading-[1.2] tracking-tight text-ink">{title}</h1>{subtitle && <p className="mt-1 max-w-[700px] text-sm leading-5 text-muted">{subtitle}</p>}</div>
    {actions && <div className="flex shrink-0 flex-col gap-2 sm:flex-row">{actions}</div>}
  </header>;
}
