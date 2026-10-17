import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessibleDrawer, AccessibleModal, AccessibleSelect } from '@/components/ui/accessible-overlay';

afterEach(cleanup);

describe('accessible overlays', () => {
  it('renders modal content with an accessible name', () => {
    const onClose = vi.fn();
    render(<AccessibleModal ariaLabel="Confirm action" onClose={onClose}><button>Continue</button></AccessibleModal>);
    expect(screen.getByRole('dialog', { name: 'Confirm action' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-slot="modal-backdrop"]')!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('nests modal content inside its customized backdrop', () => {
    render(<AccessibleModal ariaLabel="Camera" onClose={vi.fn()} backdropClassName="z-[100]"><video aria-label="Camera preview" /></AccessibleModal>);
    const backdrop = document.querySelector('[data-slot="modal-backdrop"]');
    const container = document.querySelector('[data-slot="modal-container"]');
    expect(backdrop?.contains(container)).toBe(true);
    expect(backdrop?.className).toContain('z-[100]');
  });

  it('centers modal content horizontally and vertically', () => {
    render(<AccessibleModal ariaLabel="Camera" onClose={vi.fn()}><video aria-label="Camera preview" /></AccessibleModal>);
    const container = document.querySelector('[data-slot="modal-container"]');
    expect(container).toHaveAttribute('data-placement', 'center');
    expect(container?.className).not.toContain('fixed');
  });

  it('renders drawer content with an accessible name', () => {
    render(<AccessibleDrawer ariaLabel="Filters" onClose={vi.fn()}><button>Apply</button></AccessibleDrawer>);
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('renders a keyboard-accessible selected option', () => {
    render(<AccessibleSelect label="Store" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All stores' }, { value: 'east', label: 'East' }]} />);
    expect(screen.getByRole('button', { name: /store/i })).toHaveTextContent('All stores');
  });
});
