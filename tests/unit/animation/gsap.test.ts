import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animateDisclosure, fadeUp, prefersReducedMotion, setDisclosureState, slidePanel, staggerIn, stateFeedback } from '@/lib/animation/gsap';

vi.mock('gsap', () => ({
  gsap: {
    to: (target: HTMLElement, options: { overflow?: string; onComplete?: () => void }) => {
      if (options.overflow) target.style.overflow = options.overflow;
      options.onComplete?.();
      return { kill: vi.fn() };
    },
  },
}));

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

  it('sets disclosure visibility immediately when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const panel = document.createElement('div');
    const onComplete = vi.fn();

    const cleanup = animateDisclosure(panel, true, onComplete);

    expect(panel.style.display).toBe('block');
    expect(panel.style.height).toBe('auto');
    expect(panel.style.opacity).toBe('1');
    expect(panel.style.overflow).toBe('');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(() => cleanup()).not.toThrow();
  });

  it('restores overflow after a disclosure opens so scrollable contents can scroll', () => {
    const panel = document.createElement('div');
    setDisclosureState(panel, true);
    expect(panel.style.overflow).toBe('');
    setDisclosureState(panel, false);
    expect(panel.style.overflow).toBe('hidden');
  });

  it('clears the temporary overflow clipping after the opening animation completes', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    const panel = document.createElement('div');
    const onComplete = vi.fn();
    animateDisclosure(panel, true, onComplete);

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(panel.style.overflow).toBe('');
  });
});
