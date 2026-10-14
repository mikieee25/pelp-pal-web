import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/layout/page-layout';

describe('PageHeader', () => {
  it('renders the shared eyebrow, title, subtitle, and consistent title weight', () => {
    render(<PageHeader eyebrow="Workspace" title="Activity" subtitle="Recent inspections" />);

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    const title = screen.getByRole('heading', { name: 'Activity' });
    expect(title).toHaveStyle({ fontWeight: '500' });
    expect(screen.getByText('Recent inspections')).toBeInTheDocument();
  });
});
