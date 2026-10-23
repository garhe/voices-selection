import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ConfirmationDialog({ title, description, busy, onCancel, children }: {
  title: string; description: string; busy: boolean; onCancel: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    document.body.style.overflow = 'hidden';
    element.showModal();
    element.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.focus({ preventScroll: true });
    return () => {
      element.close(); document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="confirmation-dialog" role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    {children}
  </dialog>;
}
