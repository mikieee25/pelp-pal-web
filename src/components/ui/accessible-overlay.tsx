'use client';

import { Drawer, ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

type OverlayProps = {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  labelledBy?: string;
  className?: string;
  backdropClassName?: string;
  dismissable?: boolean;
  testId?: string;
};

export function AccessibleSelect({ id, label, value, onChange, options, disabled = false, required = false, className = '' }: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  const labelId = id ?? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-select-label`;
  return <div className={`min-w-0 ${className}`}>
    <span id={labelId} className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
    <Select.Root data-testid={id} aria-labelledby={labelId} selectedKey={value} onSelectionChange={(key) => onChange(key == null ? '' : String(key))} isDisabled={disabled} isRequired={required}>
      <Select.Trigger className="flex min-h-12 w-full items-center justify-between gap-3 rounded-control border border-border-strong bg-white px-3 text-left text-base text-ink focus-visible:outline-2 focus-visible:outline-focus">
        <Select.Value className="min-w-0 flex-1 truncate" />
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </Select.Trigger>
      <Select.Popover className="z-[60] max-h-72 min-w-[var(--trigger-width)] overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-lg">
        <ListBox aria-label={label} className="outline-none">
          {options.map((option) => <ListBox.Item key={option.value} id={option.value} textValue={option.label} isDisabled={option.disabled} className="min-h-11 cursor-pointer rounded-md px-3 py-2 text-sm text-ink outline-none hover:bg-surface-alt focus:bg-primary-soft data-[selected]:font-semibold">{option.label}</ListBox.Item>)}
        </ListBox>
      </Select.Popover>
    </Select.Root>
  </div>;
}

export function AccessibleModal({ onClose, children, ariaLabel, labelledBy, className = '', backdropClassName = '', dismissable = true, testId }: OverlayProps) {
  const state = useOverlayState({ defaultOpen: true, onOpenChange: (open) => { if (!open) onClose(); } });
  return <Modal.Root state={state}>
    <Modal.Trigger className="sr-only" aria-hidden="true" tabIndex={-1}>Open dialog</Modal.Trigger>
    <Modal.Backdrop className={`fixed inset-0 z-50 bg-ink/50 ${backdropClassName}`} isDismissable={dismissable} onClick={(event) => { if (dismissable && event.target === event.currentTarget) onClose(); }}>
      <Modal.Container placement="center">
        <Modal.Dialog data-testid={testId} aria-label={ariaLabel} aria-labelledby={labelledBy} className={`w-full ${className}`}>{children}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal.Root>;
}

export function AccessibleDrawer({ onClose, children, ariaLabel, labelledBy, className = '', backdropClassName = '', dismissable = true, testId, placement = 'bottom' }: OverlayProps & { placement?: 'bottom' | 'left' | 'right' }) {
  const state = useOverlayState({ defaultOpen: true, onOpenChange: (open) => { if (!open) onClose(); } });
  return <Drawer.Root state={state}>
    <Drawer.Trigger className="hidden" aria-hidden="true">Open drawer</Drawer.Trigger>
    <Drawer.Backdrop className={`fixed inset-0 z-50 bg-ink/50 ${backdropClassName}`} isDismissable={dismissable} onClick={(event) => { if (dismissable && event.target === event.currentTarget) onClose(); }}>
      <Drawer.Content placement={placement} className={placement === 'bottom' ? 'fixed inset-x-0 bottom-0 z-50' : 'fixed inset-y-0 right-0 z-50'}>
        <Drawer.Dialog data-testid={testId} aria-label={ariaLabel} aria-labelledby={labelledBy} className={`w-full ${className}`}>{children}</Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  </Drawer.Root>;
}
