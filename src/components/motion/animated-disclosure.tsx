'use client';

import { Accordion } from '@heroui/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animateDisclosure, setDisclosureState } from '@/lib/animation/gsap';

export function AnimatedDisclosure({
  id,
  summary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className = '',
  summaryClassName = '',
  panelClassName = '',
  testId,
  ariaLabel,
  headingLevel = 3,
  disabled = false,
}: {
  id: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  summaryClassName?: string;
  panelClassName?: string;
  testId?: string;
  ariaLabel?: string;
  headingLevel?: number;
  disabled?: boolean;
}) {
  const controlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlled ? controlledOpen : internalOpen;
  const panelRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.inert = !isOpen;
    if (!initialized.current) {
      setDisclosureState(panel, isOpen);
      initialized.current = true;
      return;
    }
    return animateDisclosure(panel, isOpen);
  }, [isOpen]);

  const toggle = () => {
    const next = !isOpen;
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return <Accordion.Root
    data-testid={testId}
    className={className}
    allowsMultipleExpanded
    isDisabled={disabled}
    expandedKeys={isOpen ? new Set([id]) : new Set()}
    onExpandedChange={(keys) => {
      const next = keys.has(id);
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    }}
  >
    <Accordion.Item id={id} isDisabled={disabled}>
      <Accordion.Heading level={headingLevel}>
        <Accordion.Trigger aria-label={ariaLabel} className={summaryClassName}>{summary}</Accordion.Trigger>
      </Accordion.Heading>
      <Accordion.Panel id={id}>
        <div ref={panelRef} id={`${id}-content`} aria-hidden={!isOpen} className={panelClassName}>{children}</div>
      </Accordion.Panel>
    </Accordion.Item>
  </Accordion.Root>;
}
