import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WorkspaceLoading from '@/app/(workspace)/loading';

describe('workspace loading state', () => {
  it('renders a stable workspace skeleton while client data loads', () => {
    render(<WorkspaceLoading />);

    expect(screen.getByRole('status', { name: /loading workspace/i })).toBeInTheDocument();
  });
});
