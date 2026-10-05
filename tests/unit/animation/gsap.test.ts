import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeUp, prefersReducedMotion } from '@/lib/animation/gsap';

describe('GSAP animation boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  it('detects reduced motion from the browser preference', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns a safe cleanup function for reduced-motion users', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const cleanup = fadeUp(document.createElement('div'));
    expect(cleanup).toEqual(expect.any(Function));
    expect(() => cleanup()).not.toThrow();
  });
});
