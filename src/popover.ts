import { useEffect, type RefObject } from 'react';

export function positionPopover(element: HTMLElement, anchor: HTMLElement, align: 'start' | 'end' = 'start') {
  const button = anchor.getBoundingClientRect(), bounds = element.getBoundingClientRect();
  const left = align === 'end' ? button.right - bounds.width : button.left;
  const below = button.bottom + 6;
  const top = below + bounds.height <= window.innerHeight - 8 ? below : button.top - bounds.height - 6;
  element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
  element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
}

export function usePopoverDismiss(open: boolean, popup: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && popup.current?.contains(event.target)) return;
      if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open, popup]);
}
