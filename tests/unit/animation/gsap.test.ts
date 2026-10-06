import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeUp, prefersReducedMotion, slidePanel, staggerIn, stateFeedback } from '@/lib/animation/gsap';

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

  it('returns safe cleanups for every supported animation boundary', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    const first = document.createElement('div');
    const second = document.createElement('div');

    for (const cleanup of [
      staggerIn([first, second]),
      slidePanel(first, 'right'),
      stateFeedback(first),
      staggerIn([]),
      slidePanel(null),
      stateFeedback(null),
    ]) {
      expect(cleanup).toEqual(expect.any(Function));
      expect(() => cleanup()).not.toThrow();
    }
  });
});
