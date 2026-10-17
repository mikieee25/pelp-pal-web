import type { ReactNode } from 'react';
import { Surface } from '@/components/ui/primitives';

export function MobileReportCard({ testId, title, metrics, compliance, status }: Readonly<{
  testId: string; title: string; metrics: Array<{ label: string; value: ReactNode }>; compliance?: string; status?: ReactNode;
}>) {
  return <Surface data-testid={testId} className="p-3">
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-base font-bold text-ink">{title}</h3><div className="flex items-center gap-2">{status}{compliance !== undefined && <span className="rounded-lg bg-primary-soft px-2 py-1 text-xs font-extrabold text-primary">{compliance}</span>}</div></div>
      <div className="grid grid-cols-2 gap-3">{metrics.map((metric) => <div key={metric.label} className="min-w-0"><div className="text-xs text-muted">{metric.label}</div><div className="break-words text-sm font-bold text-ink">{metric.value}</div></div>)}</div>
    </div>
  </Surface>;
}
