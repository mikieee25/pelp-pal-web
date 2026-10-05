'use client';

import { gsap } from 'gsap';
import { designTokens } from '@/theme/tokens';

export type AnimationCleanup = () => void;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fadeUp(target: Element | null): AnimationCleanup {
  if (!target || prefersReducedMotion()) return () => {};

  const context = gsap.context(() => {
    gsap.fromTo(
      target,
      { autoAlpha: 0, y: designTokens.motion.offset },
      {
        autoAlpha: 1,
        y: 0,
        duration: designTokens.motion.duration.standard,
        ease: designTokens.motion.ease.standard,
      },
    );
  }, target);

  return () => context.revert();
}
