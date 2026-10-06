'use client';

import { useState } from 'react';
import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import { VisibilityOffRounded, VisibilityRounded } from '@mui/icons-material';

export type PasswordFieldProps = TextFieldProps & {
  showPasswordLabel?: string;
};

export function PasswordField({ showPasswordLabel = 'Show password', InputProps, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hidePasswordLabel = 'Hide password';

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      InputProps={{
        ...InputProps,
        endAdornment: (
          <InputAdornment position="end">
            {InputProps?.endAdornment}
            <IconButton
              type="button"
              edge="end"
              aria-label={visible ? hidePasswordLabel : showPasswordLabel}
              aria-pressed={visible}
              onClick={() => setVisible((current) => !current)}
              onMouseDown={(event) => event.preventDefault()}
            >
              {visible ? <VisibilityOffRounded /> : <VisibilityRounded />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}
