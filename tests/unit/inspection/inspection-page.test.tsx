import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/motion/animated-route', () => ({ AnimatedRoute: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/features/inspection/inspection-editor', () => ({ InspectionEditor: () => null }));
vi.mock('@/features/store/inspection-guard', () => ({ InspectionGuard: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/features/auth/workspace-auth-gate', () => ({ WorkspaceAuthGate: ({ children }: { children: React.ReactNode }) => children }));

import InspectionPage from '@/app/inspect/[inspectionId]/page';

describe('InspectionPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('redirects /inspect/new to a UUID before rendering and preserves query parameters', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' });
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });

    await expect(InspectionPage({
      params: Promise.resolve({ inspectionId: 'new' }),
      searchParams: Promise.resolve({ catalogId: 'catalog item', view: '1', extra: ['a', 'b'] }),
    })).rejects.toThrow('REDIRECT:/inspect/123e4567-e89b-42d3-a456-426614174000?catalogId=catalog+item&view=1&extra=a&extra=b');
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it('wraps the standalone editor route in one main landmark', async () => {
    render(await InspectionPage({ params: Promise.resolve({ inspectionId: 'inspection-1' }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
