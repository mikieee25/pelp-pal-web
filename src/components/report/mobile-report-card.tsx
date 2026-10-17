import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, TriangleAlert } from 'lucide-react';
import { Surface } from '@/components/ui/primitives';

export function MobileReportCard({ testId, title, metrics, compliance, status }: Readonly<{
  testId: string; title: string; metrics: Array<{ label: string; value: ReactNode }>; compliance?: string; status?: ReactNode;
}>) {
  const percent = compliance === undefined ? null : Number.parseFloat(compliance);
  const complianceTone = percent === null || Number.isNaN(percent)
    ? { className: 'border-border bg-surface-alt text-muted', Icon: AlertCircle }
    : percent >= 90
      ? { className: 'border-success/30 bg-success-soft text-success', Icon: CheckCircle2 }
      : percent >= 70
        ? { className: 'border-warning/30 bg-warning-soft text-warning', Icon: TriangleAlert }
        : { className: 'border-danger/30 bg-danger-soft text-danger', Icon: AlertCircle };
  return <Surface data-testid={testId} className="p-3">
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-base font-bold text-ink">{title}</h3><div className="flex items-center gap-2">{status}{compliance !== undefined && <span data-testid="compliance-rate-badge" className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-extrabold ${complianceTone.className}`}><complianceTone.Icon aria-hidden="true" className="size-3.5" />{compliance}</span>}</div></div>
      <div className="grid grid-cols-2 gap-3">{metrics.map((metric) => <div key={metric.label} className="min-w-0"><div className="text-xs text-muted">{metric.label}</div><div className="break-words text-sm font-bold text-ink">{metric.value}</div></div>)}</div>
    </div>
  </Surface>;
}
