import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AnimatedRoute } from "@/components/motion/animated-route";

export const revalidate = 3600;

export default function HomePage() {
  return (
    <AnimatedRoute>
      <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="w-full space-y-6">
            <div className="flex items-center gap-3.5">
              <div className="relative size-[72px] shrink-0 sm:size-[84px]">
                <Image
                  src="/icons/Energi.png"
                  alt="Energi, the PELP Pal mascot"
                  fill
                  priority
                  sizes="(max-width: 640px) 72px, 84px"
                  className="object-contain"
                />
              </div>
              <div>
                <p className="text-2xl font-extrabold tracking-tight text-ink">
                  PELP Pal
                </p>
                <p className="text-sm font-medium text-muted">
                  Department of Energy inspection workspace
                </p>
              </div>
            </div>

            <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-3.5 py-1 text-xs font-bold tracking-wider text-primary">
              OFFLINE-FIRST INSPECTION WORKSPACE
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl md:text-5xl lg:text-6xl">
                PELP Pal, ready when the field is.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                Inspections and evidence are saved locally first; they become
                team data after a successful sync.
              </p>
            </div>

            <Link
              href="/login"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-white shadow-sm transition-all hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98] sm:w-fit"
            >
              Sign in <ArrowRight aria-hidden="true" className="size-4" />
            </Link>

            <p className="text-xs text-muted sm:text-sm">
              Sign in with your personnel account to manage inspections and
              sync shared work from any authorized browser.
            </p>

            <div
              aria-label="Official Department of Energy branding"
              className="flex items-center gap-5 pt-4"
            >
              <div className="relative size-14 shrink-0 sm:size-16">
                <Image
                  src="/icons/doe_logo_official.png"
                  alt="Department of Energy Philippines official seal"
                  fill
                  sizes="64px"
                  className="object-contain"
                />
              </div>
              <div className="h-12 border-l border-border" />
              <div className="relative h-14 w-24 shrink-0 sm:h-16 sm:w-28">
                <Image
                  src="/icons/Bagong Pilipinas.png"
                  alt="Bagong Pilipinas logo"
                  fill
                  sizes="112px"
                  className="object-contain"
                />
              </div>
            </div>
        </section>
      </main>
    </AnimatedRoute>
  );
}
