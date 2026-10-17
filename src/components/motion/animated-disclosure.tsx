'use client';

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

  return <section data-testid={testId} className={className}>
    <button type="button" aria-label={ariaLabel} aria-expanded={isOpen} aria-controls={id} onClick={toggle} className={summaryClassName}>{summary}</button>
    <div ref={panelRef} id={id} aria-hidden={!isOpen} className={panelClassName}>{children}</div>
  </section>;
}
