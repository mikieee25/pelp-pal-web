import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/page';

describe('application shell', () => {
  it('renders without requiring Supabase configuration', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /pelp pal/i })).toBeInTheDocument();
  });
});
