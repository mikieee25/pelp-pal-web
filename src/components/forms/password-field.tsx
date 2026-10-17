'use client';

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export type PasswordFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  fullWidth?: boolean;
  helperText?: ReactNode;
  error?: boolean;
  showPasswordLabel?: string;
};

export function PasswordField({ label = 'Password', showPasswordLabel = 'Show password', helperText, error = false, fullWidth = true, className = '', id, disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? props.name ?? 'password-field';
  const hidePasswordLabel = 'Hide password';
  return <div className={`${fullWidth ? 'w-full' : ''} ${className}`}>
    <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
    <div className={`flex h-12 items-center rounded-control border bg-white px-3 focus-within:ring-2 focus-within:ring-focus ${error ? 'border-danger' : 'border-border-strong'}`}>
      <input {...props} id={inputId} disabled={disabled} type={visible ? 'text' : 'password'} className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60" />
      <button type="button" disabled={disabled} aria-label={visible ? hidePasswordLabel : showPasswordLabel} aria-pressed={visible} onClick={() => setVisible((current) => !current)} className="grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50">{visible ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}</button>
    </div>
    {helperText && <div className={`mt-1 text-xs ${error ? 'text-danger' : 'text-muted'}`}>{helperText}</div>}
  </div>;
}
