import { ArrowRight, CloudOff, LockKeyhole, PanelsTopLeft } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatedRoute } from '@/components/motion/animated-route';

export const revalidate = 3600;

export default function HomePage() {
  return <AnimatedRoute><main className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 md:grid-cols-[1.1fr_.9fr] md:gap-16 md:py-16">
    <section className="space-y-6">
      <div className="flex items-center gap-3"><Image src="/icons/Energi.png" alt="Energi, the PELP Pal mascot" width={88} height={88} priority sizes="(max-width: 600px) 72px, 88px" className="size-[72px] shrink-0 object-contain sm:size-[88px]" /><div><p className="text-xl font-extrabold text-ink">PELP Pal</p><p className="text-sm text-muted">Department of Energy inspection workspace</p></div></div>
      <span className="inline-flex min-h-8 items-center rounded-full border border-primary px-3 text-xs font-bold tracking-wide text-primary">OFFLINE-FIRST INSPECTION WORKSPACE</span>
      <div className="space-y-3"><h1 className="max-w-[640px] text-4xl font-semibold leading-tight tracking-tight text-ink md:text-6xl">PELP Pal, ready when the field is.</h1><p className="max-w-[560px] text-base leading-6 text-muted md:text-lg">Capture inspections, keep evidence nearby, and sync safely when an authorized personnel account reconnects.</p></div>
      <Link href="/login" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-primary px-5 font-semibold text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Sign in <ArrowRight aria-hidden="true" className="size-4" /></Link>
      <p className="text-sm text-muted">Sign in with your personnel account to manage inspections and sync shared work from any authorized browser.</p>
      <div aria-label="Official Department of Energy branding" className="flex items-center gap-4 pt-2 sm:gap-6"><Image src="/icons/doe_logo_official.png" alt="Department of Energy Philippines official seal" width={78} height={78} sizes="(max-width: 600px) 64px, 78px" className="size-16 shrink-0 object-contain sm:size-[78px]" /><div className="h-16 border-l border-border" /><Image src="/icons/Bagong Pilipinas.png" alt="Bagong Pilipinas logo" width={96} height={84} sizes="(max-width: 600px) 78px, 96px" className="h-[72px] w-[78px] shrink-0 object-contain sm:h-[84px] sm:w-24" /></div>
    </section>
    <section className="space-y-5 rounded-xl border border-border bg-white p-5 sm:p-7">
      <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-lg bg-primary text-white"><PanelsTopLeft aria-hidden="true" /></span><div><h2 className="text-lg font-semibold text-ink">Built for unreliable signal</h2><p className="text-sm text-muted">Your local workspace is the working copy.</p></div></div>
      <div className="border-t border-border" />
      <StatusRow icon={<CloudOff aria-hidden="true" />} title="Offline data stays on this browser" detail="Drafts and pending work remain available without a connection." />
      <StatusRow icon={<LockKeyhole aria-hidden="true" />} title="Access follows your personnel account" detail="Catalog scope and sync permissions follow the signed-in account." />
    </section>
  </main></AnimatedRoute>;
}

function StatusRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="flex items-start gap-3"><div className="pt-1 text-primary">{icon}</div><div><h3 className="font-semibold text-ink">{title}</h3><p className="text-sm text-muted">{detail}</p></div></div>;
}
