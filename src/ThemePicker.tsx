import { useEffect, useId, useRef, useState } from 'react';
import { positionPopover, usePopoverDismiss } from './popover';
import { DEFAULT_THEME_COLOR, THEME_STORAGE_KEY, themeFamilies, themePalette, themePresets, validThemeColor } from './theme';

export function ThemePicker() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(DEFAULT_THEME_COLOR);
  const [error, setError] = useState('');
  const selected = themePresets.find(preset => preset.color === color.toLowerCase());
  usePopoverDismiss(open, popup);

  function apply(color: string) {
    for (const [name, value] of Object.entries(themePalette(color)))
      document.documentElement.style.setProperty(name, value);
    setColor(color);
  }
  useEffect(() => {
    apply(DEFAULT_THEME_COLOR);
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved !== null && !validThemeColor(saved)) throw new Error('The saved interface color is invalid. Choose a new color or reset it.');
      if (saved !== null) apply(saved);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to load your saved interface color.');
    }
  }, []);

  function choose(color: string, reset = false) {
    apply(color);
    try {
      if (reset) localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, color);
      setError('');
    } catch {
      setError('The color is applied for this session, but this browser could not save it. Check browser storage permissions.');
    }
  }
  return <>
    <button ref={trigger} className="secondary theme-trigger" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}>
      <span className="theme-swatch" style={{ backgroundColor: color }} aria-hidden="true" /> Color
    </button>
    <div ref={popup} id={id} className="theme-menu" popover="auto" role="dialog" aria-label="Color & shade"
      onToggle={event => {
        const visible = event.currentTarget.matches(':popover-open');
        setOpen(visible);
        if (visible) {
          positionPopover(event.currentTarget, trigger.current!, 'end');
          event.currentTarget.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          popup.current?.hidePopover();
          trigger.current?.focus({ preventScroll: true });
        }
      }}>
      <div className="theme-menu-heading"><h2>Color &amp; shade</h2><button className="text-button" onClick={() => {
        popup.current?.hidePopover(); trigger.current?.focus({ preventScroll: true });
      }}>Done</button></div>
      <div className="theme-presets" role="group" aria-label="Color families and shades">
        {themeFamilies.map(family => <div className="theme-preset-column" key={family.name} role="group" aria-label={family.name}>
          <span className="theme-family-name" aria-hidden="true">{family.name}</span>
          {themePresets.filter(preset => preset.family === family.name).map(preset => <button key={preset.name} className="theme-preset" aria-label={`Use ${preset.name} color`}
            title={`${preset.family} / ${preset.shade}`} aria-pressed={color.toLowerCase() === preset.color} onClick={() => choose(preset.color)}>
            <span className="theme-swatch" style={{ backgroundColor: preset.color }} aria-hidden="true" />
          </button>)}
        </div>)}
      </div>
      <label className="theme-custom">Custom color
        <input type="color" value={color} onChange={event => choose(event.target.value)} />
      </label>
      <div className="theme-menu-footer"><span role="status">{selected ? `${selected.family} / ${selected.shade}` : `Custom / ${color.toUpperCase()}`}</span><button className="text-button" aria-label="Reset to default" onClick={() => choose(DEFAULT_THEME_COLOR, true)}>Reset</button></div>
    </div>
    {error && <div className="theme-error" role="alert">{error}</div>}
  </>;
}
