'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Activity, ClipboardList, LayoutDashboard, Menu, Search, Settings, Users, X, FileText, RefreshCw } from 'lucide-react';
import { getCurrentAccount, type CurrentAccount } from '@/features/auth/account-password';
import { AccessibleDrawer } from '@/components/ui/accessible-overlay';
import { SyncStatusPill } from './sync-status-pill';

const navigation = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Lookup', href: '/lookup', icon: Search },
  { label: 'Activity', href: '/activity', icon: Activity },
  { label: 'Summary', href: '/summary', icon: ClipboardList },
  { label: 'Report', href: '/report', icon: FileText },
  { label: 'Sync', href: '/sync', icon: RefreshCw },
  { label: 'Personnel', href: '/personnel', icon: Users },
  { label: 'Account', href: '/account', icon: Settings },
] as const;
const primaryNavigation = navigation.slice(0, 4);

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? '';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [account, setAccount] = useState<CurrentAccount>();
  const selected = navigation.find((item) => pathname.startsWith(item.href))?.href ?? '/dashboard';
  const canManagePersonnel = account?.isActive === true && account.role === 'admin';

  useEffect(() => {
    let active = true;
    void getCurrentAccount().then((current) => { if (active) setAccount(current); }).catch(() => { if (active) setAccount(undefined); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMenuOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMenuOpen]);

  return <div className="app-shell flex min-h-dvh bg-surface-alt pb-[calc(64px+env(safe-area-inset-bottom))] text-ink md:pb-0">
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-white pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex min-h-16 items-center justify-between gap-2 px-3 sm:px-4">
        <Brand compact />
        <div className="flex shrink-0 items-center gap-1"><SyncStatusPill /><button type="button" aria-label="Open workspace menu" onClick={() => setIsMenuOpen(true)} className="grid size-11 place-items-center rounded-lg text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus"><Menu aria-hidden="true" /></button></div>
      </div>
    </header>

    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r border-border bg-white md:block">
      <div className="flex flex-col px-4 pb-3 pt-4"><Brand /><div data-testid="drawer-sync-status" className="ml-[50px] mt-2 min-w-0"><SyncStatusPill /></div></div>
      <div className="border-t border-border px-3 py-4"><div className="px-3 text-xs font-bold uppercase tracking-wider text-muted">Workspace</div><NavigationList selected={selected} canManagePersonnel={canManagePersonnel} /></div>
    </aside>

    {isMenuOpen && <AccessibleDrawer onClose={() => setIsMenuOpen(false)} ariaLabel="Workspace menu" placement="right" className="flex h-full w-[min(88vw,340px)] flex-col bg-white p-4 shadow-xl" backdropClassName="bg-ink/40 md:hidden">
        <div className="flex items-center justify-between"><Brand compact /><button type="button" aria-label="Close workspace menu" onClick={() => setIsMenuOpen(false)} className="grid size-11 place-items-center rounded-lg hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus"><X aria-hidden="true" /></button></div>
        <div className="my-4 border-t border-border" /><div className="px-3 text-xs font-bold uppercase tracking-wider text-ink">Workspace</div><NavigationList selected={selected} canManagePersonnel={canManagePersonnel} onNavigate={() => setIsMenuOpen(false)} />
    </AccessibleDrawer>}

    <main className="min-w-0 flex-1 pt-[calc(64px+env(safe-area-inset-top))] md:ml-[240px] md:pt-0">{children}</main>

    <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-40 flex min-h-16 items-center justify-around border-t border-border bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      {primaryNavigation.map(({ label, href, icon: Icon }) => <Link key={href} href={href} aria-label={label} aria-current={selected === href ? 'page' : undefined} className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-4 ${selected === href ? 'font-semibold text-primary' : 'text-muted'}`}><Icon aria-hidden="true" className="size-5" /><span>{label}</span></Link>)}
    </nav>
  </div>;
}

function NavigationList({ selected, canManagePersonnel, onNavigate }: { selected: string; canManagePersonnel: boolean; onNavigate?: () => void }) {
  return <nav aria-label="Workspace navigation" className="mt-2 space-y-1">{navigation.filter((item) => item.href !== '/personnel' || canManagePersonnel).map(({ label, href, icon: Icon }) => <Link key={href} href={href} onClick={onNavigate} aria-current={selected === href ? 'page' : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${selected === href ? 'bg-primary-soft font-semibold text-primary' : 'text-ink hover:bg-surface-alt'}`}><Icon aria-hidden="true" className="size-[18px]" /><span>{label}</span></Link>)}</nav>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`flex min-w-0 items-center gap-2.5 ${compact ? 'flex-1 md:hidden' : 'w-full'}`}>
    <Image src="/icons/Energi.png" alt="Energi, the PELP Pal mascot" width={40} height={40} sizes="40px" priority className="size-10 shrink-0 object-contain" />
    <div className="min-w-0 flex-1"><div className="block truncate text-base font-extrabold leading-5 text-ink">PELP Pal</div><div className="hidden truncate text-xs leading-4 text-muted min-[400px]:block">Inspection workspace</div></div>
  </div>;
}
