import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/page';

describe('application shell', () => {
  it('renders without requiring Supabase configuration', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /pelp pal/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    expect(screen.getByText(/offline data stays on this browser/i)).toBeInTheDocument();
  });
});
