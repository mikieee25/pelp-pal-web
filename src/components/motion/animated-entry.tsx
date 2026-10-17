'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { fadeUp, noticeFeedback } from '@/lib/animation/gsap';

export function AnimatedEntry({ children, className = '', effect = 'feedback' }: { children: ReactNode; className?: string; effect?: 'feedback' | 'rise' }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (effect === 'rise' ? fadeUp(ref.current) : noticeFeedback(ref.current)), [effect]);
  return <div ref={ref} className={className}>{children}</div>;
}
