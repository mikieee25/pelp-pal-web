import { createElement, forwardRef, type ButtonHTMLAttributes, type ElementType, type HTMLAttributes, type MouseEventHandler, type ReactNode } from 'react';
import { Alert, Button } from '@heroui/react';
import { Check, ChevronRight, CloudCheck, CircleAlert, Clock3, Info, TriangleAlert } from 'lucide-react';
import { designTokens } from '@/theme/tokens';
import { AnimatedEntry } from '@/components/motion/animated-entry';

const styles = {
  page: 'mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6 md:py-10',
  muted: 'text-sm text-muted',
  title: 'text-xl font-semibold leading-7 tracking-tight text-ink',
};

export function PageShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`${styles.page} ${className}`}>{children}</main>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return <header className="mb-6 flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start">
    <div className="min-w-0"><h1 className="text-display font-semibold leading-[1.2] tracking-tight text-ink">{title}</h1>{subtitle && <p className="mt-2 text-sm leading-5 text-muted">{subtitle}</p>}</div>
    {actions && <div className="flex shrink-0 flex-col gap-2 sm:flex-row">{actions}</div>}
  </header>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <section aria-label={title} className="min-w-0"><div className="mb-3 flex items-center justify-between gap-3"><h2 className={styles.title}>{title}</h2>{actions}</div><div className="mb-4 border-b border-border" />{children}</section>;
}

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string; sx?: unknown; component?: ElementType };
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface({ children, className = '', sx: _sx, component: Component = 'div', ...props }, ref) {
  return createElement(Component, { ...props, ref, className: `rounded-xl border border-border bg-white shadow-none ${className}` }, children);
});

export function ListRow({ leading, primary, secondary, trailing, chevron = false, onClick, 'aria-label': ariaLabel, className = '' }: {
  leading?: ReactNode; primary: ReactNode; secondary?: ReactNode; trailing?: ReactNode; chevron?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>; 'aria-label'?: string; className?: string;
}) {
  const textName = [primary, secondary, trailing].filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').join(' ');
  const content = <span className="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 text-left">
    {leading && <span className="grid shrink-0 place-items-center">{leading}</span>}
    <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-ink">{primary}</span>{secondary && <span className="block break-words text-sm text-muted">{secondary}</span>}</span>
    {trailing && <span className="shrink-0"> {trailing}</span>}{chevron && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />}
  </span>;
  return onClick ? <button type="button" onClick={onClick} aria-label={ariaLabel ?? (textName || undefined)} className={`w-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus hover:bg-surface-alt ${className}`}>{content}</button> : <div aria-label={ariaLabel} className={`px-1 ${className}`}>{content}</div>;
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return <div className="space-y-1"><div className="text-2xl font-semibold tabular-nums text-ink">{value}</div><div className="text-sm text-muted">{label}</div></div>;
}

const statusStyles = {
  compliant: { label: 'Compliant', tone: 'success', Icon: Check },
  nonCompliant: { label: 'Non-compliant', tone: 'danger', Icon: CircleAlert },
  synced: { label: 'Synced', tone: 'primary', Icon: CloudCheck },
  waiting: { label: 'Waiting', tone: 'warning', Icon: Clock3 },
  attention: { label: 'Needs attention', tone: 'danger', Icon: TriangleAlert },
  neutral: { label: 'Not available', tone: 'neutral', Icon: Info },
} as const;
export function StatusBadge({ variant, label }: { variant: keyof typeof statusStyles; label?: string }) {
  const status = statusStyles[variant]; const Icon = status.Icon;
  return <span role="status" aria-label={`${label ?? status.label} status`} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold leading-4 ${status.tone === 'success' ? 'bg-success-soft text-success' : status.tone === 'danger' ? 'bg-danger-soft text-danger' : status.tone === 'warning' ? 'bg-warning-soft text-warning' : status.tone === 'primary' ? 'bg-primary-soft text-primary' : 'bg-surface-alt text-muted'}`}><Icon aria-hidden="true" className="size-4" />{label ?? status.label}</span>;
}

export function EmptyState({ icon, message, action }: { icon: ReactNode; message: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-3 py-8 text-center"><div aria-hidden="true" className="text-muted">{icon}</div><p className="text-sm text-muted">{message}</p>{action}</div>;
}

export type InlineNoticeProps = Omit<HTMLAttributes<HTMLDivElement>, 'color'> & { severity?: 'success' | 'info' | 'warning' | 'error'; sx?: unknown; action?: ReactNode };
export function InlineNotice({ severity = 'info', children, className = '', sx: _sx, action, ...props }: InlineNoticeProps) {
  const status = severity === 'error' ? 'danger' : severity === 'info' ? 'default' : severity;
  return <AnimatedEntry><Alert.Root role="alert" status={status} className={`rounded-lg ${className}`} {...props}><Alert.Indicator /><Alert.Content>{children}</Alert.Content>{action}</Alert.Root></AnimatedEntry>;
}

export function ActionBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <footer data-testid="action-bar" className={`sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border bg-white p-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:static sm:flex-row sm:border-0 sm:bg-transparent sm:p-0 ${className}`}>{children}</footer>;
}

export function KeyValueList({ items, className = '' }: { items: readonly { label: string; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return <dl className={`divide-y divide-border ${className}`}>{items.map(({ label, value, mono }) => <div key={label} className="flex min-w-0 items-center justify-between gap-4 py-3"><dt className="shrink-0 text-sm text-muted">{label}</dt><dd className={`m-0 min-w-0 break-words text-right text-sm font-semibold text-ink ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</dd></div>)}</dl>;
}

export const uiTokens = designTokens;
export { Button };
export type { ButtonHTMLAttributes };
