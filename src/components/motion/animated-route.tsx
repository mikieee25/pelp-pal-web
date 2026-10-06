'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { fadeUp } from '@/lib/animation/gsap';

export function AnimatedRoute({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      cleanupRef.current = fadeUp(contentRef.current);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      cleanupRef.current?.();
      cleanupRef.current = undefined;
    };
  }, [pathname]);

  return <div ref={contentRef} style={{ minWidth: 0 }}>{children}</div>;
}
