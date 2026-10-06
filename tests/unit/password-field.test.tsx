import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordField } from '@/components/forms/password-field';

describe('PasswordField', () => {
  afterEach(cleanup);

  it('keeps the password hidden by default and toggles visibility accessibly', () => {
    render(<PasswordField label="Password" value="secret" onChange={() => {}} />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });
});
