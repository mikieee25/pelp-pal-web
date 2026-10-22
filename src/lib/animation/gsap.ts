'use client';

import { designTokens } from '@/theme/tokens';

export type AnimationCleanup = () => void;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateWhenLoaded(target: Element, run: (gsap: typeof import('gsap').gsap) => () => void): AnimationCleanup {
  let cancelled = false;
  let revert: (() => void) | undefined;
  void import('gsap').then(({ gsap }) => {
    if (!cancelled && !prefersReducedMotion()) revert = run(gsap);
  });
  return () => {
    cancelled = true;
    revert?.();
  };
}

export function fadeUp(target: Element | null, options: { delay?: number } = {}): AnimationCleanup {
  if (!target || prefersReducedMotion()) return () => {};

  return animateWhenLoaded(target, (gsap) => {
    const context = gsap.context(() => {
    gsap.fromTo(
      target,
      { autoAlpha: 0, y: designTokens.motion.offset },
      {
        autoAlpha: 1,
        y: 0,
        delay: options.delay ?? 0,
        duration: designTokens.motion.duration.standard,
        ease: designTokens.motion.ease.standard,
      },
    );
    }, target);
    return () => context.revert();
  });
}

export function staggerIn(
  targets: Element[] | NodeListOf<Element>,
  options: { delay?: number } = {},
): AnimationCleanup {
  const elements = Array.from(targets);
  if (elements.length === 0 || prefersReducedMotion()) return () => {};

  return animateWhenLoaded(elements[0], (gsap) => {
    const context = gsap.context(() => {
    gsap.fromTo(
      elements,
      { autoAlpha: 0, y: designTokens.motion.offset },
      {
        autoAlpha: 1,
        y: 0,
        delay: options.delay ?? 0,
        duration: designTokens.motion.duration.standard,
        ease: designTokens.motion.ease.standard,
        stagger: designTokens.motion.stagger,
      },
    );
    }, elements[0]);
    return () => context.revert();
  });
}

export function slidePanel(
  target: Element | null,
  direction: 'left' | 'right' = 'right',
): AnimationCleanup {
  if (!target || prefersReducedMotion()) return () => {};

  return animateWhenLoaded(target, (gsap) => {
    const context = gsap.context(() => {
    gsap.fromTo(
      target,
      { autoAlpha: 0, x: direction === 'right' ? designTokens.motion.panelOffset : -designTokens.motion.panelOffset },
      {
        autoAlpha: 1,
        x: 0,
        duration: designTokens.motion.duration.standard,
        ease: designTokens.motion.ease.emphasized,
      },
    );
    }, target);
    return () => context.revert();
  });
}

export function stateFeedback(target: Element | null): AnimationCleanup {
  if (!target || prefersReducedMotion()) return () => {};

  return animateWhenLoaded(target, (gsap) => {
    const context = gsap.context(() => {
    gsap.fromTo(
      target,
      { autoAlpha: 0, scale: 0.98 },
      {
        autoAlpha: 1,
        scale: 1,
        duration: designTokens.motion.duration.fast,
        ease: designTokens.motion.ease.standard,
      },
    );
    }, target);
    return () => context.revert();
  });
}

export function noticeFeedback(target: Element | null): AnimationCleanup {
  if (!target || prefersReducedMotion()) return () => {};
  return animateWhenLoaded(target, (gsap) => {
    const context = gsap.context(() => {
      gsap.fromTo(target, { scale: 0.99, y: 3 }, {
        scale: 1,
        y: 0,
        duration: designTokens.motion.duration.fast,
        ease: designTokens.motion.ease.standard,
      });
    }, target);
    return () => context.revert();
  });
}

export function animateDisclosure(target: HTMLElement | null, expanded: boolean, onComplete?: () => void): AnimationCleanup {
  if (!target) return () => {};
  const finalState = { height: expanded ? 'auto' : 0, autoAlpha: expanded ? 1 : 0 };
  if (prefersReducedMotion()) {
    target.style.display = expanded ? 'block' : 'none';
    target.style.height = expanded ? 'auto' : '0px';
    target.style.opacity = expanded ? '1' : '0';
    target.style.visibility = expanded ? 'visible' : 'hidden';
    target.style.overflow = expanded ? '' : 'hidden';
    onComplete?.();
    return () => {};
  }

  if (expanded) target.style.display = 'block';
  let cancelled = false;
  let tween: { kill: () => void } | undefined;
  void import('gsap').then(({ gsap }) => {
    if (cancelled) return;
    if (prefersReducedMotion()) {
      target.style.height = expanded ? 'auto' : '0px';
      target.style.opacity = expanded ? '1' : '0';
      target.style.visibility = expanded ? 'visible' : 'hidden';
      target.style.overflow = expanded ? '' : 'hidden';
      if (!expanded) target.style.display = 'none';
      onComplete?.();
      return;
    }
    tween = gsap.to(target, {
      ...finalState,
      overflow: 'hidden',
      duration: designTokens.motion.duration.standard,
      ease: designTokens.motion.ease.standard,
      onComplete: () => {
        if (expanded) target.style.removeProperty('overflow');
        if (!expanded) target.style.display = 'none';
        onComplete?.();
      },
    });
  });
  return () => { cancelled = true; tween?.kill(); };
}

export function setDisclosureState(target: HTMLElement | null, expanded: boolean): void {
  if (!target) return;
  target.style.display = expanded ? 'block' : 'none';
  target.style.height = expanded ? 'auto' : '0px';
  target.style.opacity = expanded ? '1' : '0';
  target.style.visibility = expanded ? 'visible' : 'hidden';
  target.style.overflow = expanded ? '' : 'hidden';
}
