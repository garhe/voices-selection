import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { canManageTest, type TestHistory } from '../shared/history';
import { positionPopover, usePopoverDismiss } from './popover';

export type ReportKind = 'json' | 'assessments' | 'voices' | 'guidance';
type TestAction = 'edit' | 'rerun' | 'delete' | ReportKind;
const groups: { label: string; actions: { value: TestAction; label: string }[] }[] = [
  { label: 'Test actions', actions: [
    { value: 'edit', label: 'Edit test details' }, { value: 'rerun', label: 'Rerun reports' }, { value: 'delete', label: 'Delete test...' },
  ] },
  { label: 'Download reports', actions: [
    { value: 'json', label: 'Complete report JSON' }, { value: 'assessments', label: 'Assessment CSV' },
    { value: 'voices', label: 'Voice summaries CSV' }, { value: 'guidance', label: 'Next-take guidance CSV' },
  ] },
];

export function TestActions({ entry, busy, onEdit, onDelete, onRegenerate, onDownload }: {
  entry: TestHistory; busy: boolean; onEdit: (entry: TestHistory) => void; onDelete: (entry: TestHistory) => void;
  onRegenerate: (entry: TestHistory) => void; onDownload: (entry: TestHistory, kind: ReportKind) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const [open, setOpen] = useState(false);
  usePopoverDismiss(open, menu);
  function items() {
    return [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  }
  function focusItem(item?: HTMLButtonElement) {
    if (!item) return;
    const element = menu.current!;
    item.focus({ preventScroll: true });
    const bottom = item.offsetTop + item.offsetHeight;
    if (item.offsetTop < element.scrollTop) element.scrollTop = item.offsetTop;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
  }
  function closeMenu(restoreFocus = true) {
    if (menu.current?.matches(':popover-open')) menu.current.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function positionMenu(last = false) {
    positionPopover(menu.current!, trigger.current!, 'end');
    const enabled = items();
    focusItem(last ? enabled.at(-1) : enabled[0]);
  }
  useEffect(() => {
    if (open && busy) closeMenu(false);
  }, [open, busy]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = items();
    const index = enabled.findIndex(item => item === document.activeElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % enabled.length; break;
      case 'ArrowUp': next = (index + enabled.length - 1) % enabled.length; break;
      case 'Home': next = 0; break;
      case 'End': next = enabled.length - 1; break;
      case 'Escape': event.preventDefault(); closeMenu(); return;
      case 'Tab': closeMenu(); return;
      default: return;
    }
    event.preventDefault();
    focusItem(enabled[next]);
  }
  function choose(value: TestAction) {
    closeMenu();
    switch (value) {
      case 'edit': onEdit(entry); break;
      case 'rerun': onRegenerate(entry); break;
      case 'delete': onDelete(entry); break;
      default: onDownload(entry, value);
    }
  }
  return <>
    <button ref={trigger} className="secondary test-action-button" aria-label={`Actions for ${entry.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id}
      disabled={busy}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); focusLast.current = event.key === 'ArrowUp';
          if (menu.current?.matches(':popover-open')) positionMenu(focusLast.current);
          else menu.current?.showPopover();
        }
      }}>Actions <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    <div ref={menu} id={id} className="test-action-menu" popover="auto" role="menu" aria-label={`Actions for ${entry.name}`}
      onToggle={event => {
        const visible = event.currentTarget.matches(':popover-open');
        setOpen(visible);
        if (visible) { positionMenu(focusLast.current); focusLast.current = false; }
      }} onKeyDown={navigate}>
      {groups.map(group => <div className="test-action-group" role="group" aria-label={group.label} key={group.label}>
        <p aria-hidden="true">{group.label}</p>
        {group.actions.map(action => <button key={action.value} role="menuitem" tabIndex={-1} data-action={action.value}
          className={action.value === 'delete' ? 'danger' : undefined} disabled={busy || (!canManageTest(entry) && (action.value === 'edit' || action.value === 'delete'))}
          onClick={() => choose(action.value)}>{action.label}</button>)}
      </div>)}
    </div>
  </>;
}
