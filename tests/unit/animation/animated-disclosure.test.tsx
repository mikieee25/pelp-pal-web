import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedDisclosure } from '@/components/motion/animated-disclosure';

describe('AnimatedDisclosure', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true })));

  it('keeps the disclosure accessible while opening and hides it when closed', async () => {
    render(<AnimatedDisclosure id="details-panel" summary="Details">Panel content</AnimatedDisclosure>);

    const trigger = screen.getByRole('button', { name: 'Details' });
    const panel = document.getElementById('details-panel-content');
    expect(document.querySelector('[data-slot="accordion"]')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveStyle({ display: 'none' });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Panel content')).toBeVisible();

    fireEvent.click(trigger);
    await waitFor(() => expect(panel).toHaveStyle({ display: 'none' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
