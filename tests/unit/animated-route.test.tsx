import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { fadeUp } from '@/lib/animation/gsap';

const cleanupAnimation = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/animation/gsap', () => ({
  fadeUp: vi.fn(() => cleanupAnimation),
}));

describe('AnimatedRoute', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('animates the route content and cleans up on unmount', async () => {
    const { unmount } = render(<AnimatedRoute><div>Dashboard content</div></AnimatedRoute>);

    expect(screen.getByText('Dashboard content')).toBeInTheDocument();
    await waitFor(() => expect(fadeUp).toHaveBeenCalledWith(expect.any(HTMLElement)));

    unmount();
    expect(cleanupAnimation).toHaveBeenCalledOnce();
  });
});
