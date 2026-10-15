import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActionBar,
  EmptyState,
  InlineNotice,
  KeyValueList,
  ListRow,
  PageHeader,
  PageShell,
  Section,
  Stat,
  StatusBadge,
  Surface,
} from '@/components/ui';

afterEach(cleanup);

describe('design-system primitives', () => {
  it('composes the page shell, header, section and bordered surface', () => {
    render(
      <PageShell>
        <PageHeader title="Sync" subtitle="Shared workspace" actions={<button>Sync now</button>} />
        <Section title="Status"><Surface data-testid="surface">Ready</Surface></Section>
      </PageShell>,
    );

    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument();
    expect(screen.getByText('Shared workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('Ready').closest('[data-testid="surface"]')).toBeInTheDocument();
  });

  it('renders a whole-row action with accessible content and chevron', () => {
    const onClick = vi.fn();
    render(<ListRow primary="Profile" secondary="Inspector" trailing="Active" chevron onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /profile inspector active/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses status text and icon, plus tabular stats and key-value pairs', () => {
    render(
      <>
        <StatusBadge variant="waiting" />
        <Stat value="1,234" label="Inspections" />
        <KeyValueList items={[{ label: 'Role', value: 'Inspector' }]} />
      </>,
    );
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toHaveStyle({ fontVariantNumeric: 'tabular-nums' });
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Inspector')).toBeInTheDocument();
  });

  it.each([
    ['compliant', 'Compliant'],
    ['nonCompliant', 'Non-compliant'],
    ['synced', 'Synced'],
    ['waiting', 'Waiting'],
    ['attention', 'Needs attention'],
    ['neutral', 'Not available'],
  ] as const)('shows an icon and readable text for %s status', (variant, label) => {
    render(<StatusBadge variant={variant} />);
    expect(screen.getByRole('status', { name: `${label} status` })).toHaveTextContent(label);
  });

  it('renders one-line empty and inline-notice states with an optional action', () => {
    render(
      <>
        <EmptyState icon={<span aria-hidden="true">i</span>} message="Nothing here" action={<button>Add</button>} />
        <InlineNotice severity="warning">Waiting for network</InlineNotice>
        <ActionBar><button>Save</button></ActionBar>
      </>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Waiting for network');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
