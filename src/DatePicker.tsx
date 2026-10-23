import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { positionPopover, usePopoverDismiss } from './popover';

const DAY = 86400000;
const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month, 1))));
const fullDate = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' });
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function calendarDateKey(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function parseCalendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isFinite(date.getTime()) && calendarDateKey(date) === value) return date;
}
export function shiftCalendarMonth(date: Date, offset: number): Date {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + offset);
  const end = new Date(next);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return next;
}
export function calendarDays(month: Date): Date[] {
  const first = new Date(month);
  first.setUTCDate(1);
  first.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => new Date(first.getTime() + index * DAY));
}
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function DatePicker({ label, value, min, max, onChange }: {
  label: string; value: string; min?: string; max?: string; onChange: (value: string) => void;
}) {
  const id = useId(), popupId = `${id}-calendar`;
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null);
  const focusGrid = useRef(true);
  const [draft, setDraft] = useState(value), [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(value || todayKey());
  const [month, setMonth] = useState(() => parseCalendarDate(value || todayKey())!);
  usePopoverDismiss(open, popup);
  useEffect(() => { setDraft(value); setError(''); }, [value]);
  useEffect(() => {
    if (open && focusGrid.current) popup.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus({ preventScroll: true });
  }, [open, focused]);
  function allowed(day: string) {
    return !!parseCalendarDate(day) && (!min || day >= min) && (!max || day <= max);
  }
  function focusDay(date: Date, moveFocus = true) {
    const lower = parseCalendarDate(min || '0001-01-01')!, upper = parseCalendarDate(max || '9999-12-31')!;
    const bounded = new Date(Math.max(lower.getTime(), Math.min(date.getTime(), upper.getTime())));
    focusGrid.current = moveFocus;
    setFocused(calendarDateKey(bounded)); setMonth(bounded);
  }
  function close() {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
    input.current?.focus({ preventScroll: true });
  }
  function choose(day: string) {
    setDraft(day); setError(''); onChange(day); close();
  }
  function validate(text: string) {
    if (!text) { setError(''); onChange(''); }
    else if (!parseCalendarDate(text)) setError('Enter a valid date as YYYY-MM-DD.');
    else if (!allowed(text)) setError(`Choose a date${min ? ` on or after ${min}` : ''}${max ? ` on or before ${max}` : ''}.`);
    else { setError(''); onChange(text); }
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLSelectElement && CSS.supports('selector(select:open)') && event.target.matches(':open')) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-day')) return;
    const date = parseCalendarDate(focused)!;
    let next: Date;
    switch (event.key) {
      case 'ArrowLeft': next = new Date(date.getTime() - DAY); break;
      case 'ArrowRight': next = new Date(date.getTime() + DAY); break;
      case 'ArrowUp': next = new Date(date.getTime() - 7 * DAY); break;
      case 'ArrowDown': next = new Date(date.getTime() + 7 * DAY); break;
      case 'Home': next = new Date(date.getTime() - date.getUTCDay() * DAY); break;
      case 'End': next = new Date(date.getTime() + (6 - date.getUTCDay()) * DAY); break;
      case 'PageUp': next = shiftCalendarMonth(date, event.shiftKey ? -12 : -1); break;
      case 'PageDown': next = shiftCalendarMonth(date, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault(); focusDay(next);
  }
  const days = calendarDays(month), today = todayKey();
  const monthNumber = month.getUTCMonth(), year = month.getUTCFullYear();
  const previousEnd = shiftCalendarMonth(month, -1), nextStart = shiftCalendarMonth(month, 1);
  previousEnd.setUTCMonth(previousEnd.getUTCMonth() + 1, 0); nextStart.setUTCDate(1);
  return <div className="date-field">
    <label htmlFor={id}>{label}</label>
    <div className="date-control" ref={control}>
      <input ref={input} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="YYYY-MM-DD" maxLength={10}
        value={draft} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : `${id}-help`}
        onChange={event => { const text = event.target.value; setDraft(text); if (!text || parseCalendarDate(text)) validate(text); }}
        onBlur={() => validate(draft)} onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); if (open) popup.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus(); else trigger.current?.click(); }
          if (event.key === 'Enter') { event.preventDefault(); validate(draft); }
        }} />
      <button ref={trigger} type="button" className="date-trigger" aria-label={`Open ${label.toLowerCase()} calendar`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={popupId} popoverTarget={popupId}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M6 2v4m8-4v4M3 8h14" /></svg>
      </button>
    </div>
    <span className="sr-only" id={`${id}-help`}>Enter YYYY-MM-DD or press Arrow Down to open the calendar. Use arrow keys for days and Page Up or Page Down for months.</span>
    {error && <p className="error-text" role="alert" id={`${id}-error`}>{error}</p>}
    <div ref={popup} id={popupId} className="date-menu" popover="auto" role="dialog" aria-label={`${label} calendar`}
      onToggle={event => {
        const visible = event.currentTarget.matches(':popover-open'); setOpen(visible);
        if (visible) { focusDay(parseCalendarDate(value || today)!); positionPopover(event.currentTarget, control.current!); }
      }} onKeyDown={navigate} onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.currentTarget.matches(':popover-open')) event.currentTarget.hidePopover();
      }}>
      <div className="calendar-header">
        <button type="button" className="calendar-nav" aria-label="Previous month" disabled={year === 1 && monthNumber === 0 || !!min && calendarDateKey(previousEnd) < min}
          onClick={() => focusDay(shiftCalendarMonth(month, -1))}>&lt;</button>
        <select aria-label={`${label} month`} value={monthNumber} onChange={event => focusDay(shiftCalendarMonth(month, Number(event.target.value) - monthNumber), false)}>
          {months.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
        <input type="number" aria-label={`${label} year`} value={year} min={1} max={9999} onChange={event => {
          const next = event.target.valueAsNumber;
          if (Number.isInteger(next) && next >= 1 && next <= 9999) focusDay(shiftCalendarMonth(month, (next - year) * 12), false);
        }} />
        <button type="button" className="calendar-nav" aria-label="Next month" disabled={year === 9999 && monthNumber === 11 || !!max && calendarDateKey(nextStart) > max}
          onClick={() => focusDay(shiftCalendarMonth(month, 1))}>&gt;</button>
      </div>
      <p className="sr-only" aria-live="polite">{months[monthNumber]} {year}</p>
      <div className="calendar-grid" role="grid" aria-label={`${months[monthNumber]} ${year}`}>
        <div role="row">{weekdays.map(day => <div role="columnheader" key={day} aria-label={day}>{day.slice(0, 2)}</div>)}</div>
        {Array.from({ length: 6 }, (_, week) => <div role="row" key={week}>
          {days.slice(week * 7, week * 7 + 7).map(date => {
            const key = calendarDateKey(date);
            return <div role="gridcell" key={key} aria-selected={key === value}>
              <button type="button" data-day={key} tabIndex={key === focused ? 0 : -1} aria-label={fullDate.format(date)}
                aria-current={key === today ? 'date' : undefined} disabled={!allowed(key)}
                className={date.getUTCMonth() !== monthNumber ? 'outside-month' : undefined} onClick={() => choose(key)}>{date.getUTCDate()}</button>
            </div>;
          })}
        </div>)}
      </div>
      <div className="calendar-footer"><button type="button" className="text-button" onClick={() => choose('')}>Clear</button>
        <button type="button" className="text-button" disabled={!allowed(today)} onClick={() => choose(today)}>Today</button></div>
    </div>
  </div>;
}
