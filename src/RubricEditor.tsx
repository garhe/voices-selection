import { useState } from 'react';
import { BOTH_SPEAKERS_TEST_GUIDE, DEFAULT_RUBRIC, labels, rubricSchema, profileRubric, type Dimension, type Profile, type Rubric } from '../shared/domain';
import { ConfirmationDialog } from './ConfirmationDialog';

export function RubricEditor({ profile, presets, busy, onChange, onSelect, onSave, onDelete, onRefresh }: {
  profile: Profile; presets?: Rubric[]; busy: boolean;
  onChange: (rubric: Rubric) => void; onSelect: (rubric: Rubric) => void;
  onSave: (rubric: Rubric, copy: boolean) => void; onDelete: (rubric: Rubric) => void; onRefresh: () => void;
}) {
  const [pending, setPending] = useState<Rubric>();
  const [editing, setEditing] = useState<{ id: Dimension; original: string }>();
  const rubric = profileRubric(profile);
  const library = presets ?? [DEFAULT_RUBRIC];
  const stored = library.find(item => item.id === rubric.id);
  const dirty = !stored || JSON.stringify(stored) !== JSON.stringify(rubric);
  const validation = rubricSchema.safeParse(rubric);
  const canCopy = !library.some(item => item.name.toLowerCase() === rubric.name.trim().toLowerCase());
  const canUpdate = stored && stored.id !== DEFAULT_RUBRIC.id && stored.revision === rubric.revision;
  const disabled = busy || !presets;
  function change(patch: Partial<Rubric>) { onChange({ ...rubric, ...patch }); }
  function select(next: Rubric) { setEditing(undefined); onSelect(next); }
  return <div className="rubric-editor">
    <label>Evaluation guide / rubric
      <select value={rubric.id} disabled={disabled} onChange={event => {
        const next = library.find(item => item.id === event.target.value);
        if (!next) return;
        if (dirty) setPending(next);
        else select(next);
      }}>
        {!stored && <option value={rubric.id}>Saved snapshot · {rubric.name}</option>}
        {library.map(item => <option key={item.id} value={item.id}>{item.name}{item.id === DEFAULT_RUBRIC.id ? ' (built-in default)' : ` · revision ${item.revision}`}</option>)}
      </select>
    </label>
    {dirty && <p className="hint" role="status">Unsaved rubric edits apply to this test's snapshot. Save a preset to reuse them in other tests.</p>}
    {dirty && stored && <button className="text-button" disabled={disabled} onClick={() => setPending(stored)}>Reload saved preset</button>}
    <details className="voice-evidence">
      <summary>Edit rubric{dirty ? ' · unsaved changes' : ''}</summary>
      <p className="hint">Enable dimensions and select the stages where they contribute. Checked dimensions contribute equally; unchecked stages exclude that dimension from preference. Click a title to rename it. Ratings remain 1–5. Audio quality is always requested, even when diagnostic only.</p>
      {stored?.dimensions.some(d => ![0, 1].includes(d.weights.audition) || ![0, 1].includes(d.weights.tts)) && <p className="hint">This draft uses equal contributions. Earlier preset weights remain unchanged until you save changes; historical tests keep their original scoring.</p>}
      <p className="hint">Audio-only assessment, role attribution, English reports and uncertainty safeguards stay in force. Saved and queued tests retain their own complete rubric snapshot.</p>
      <label>Rubric name<input value={rubric.name} maxLength={80} disabled={disabled} onChange={event => change({ name: event.target.value })} /></label>
      <label>Evaluation instructions<textarea rows={4} value={rubric.instructions} maxLength={6000} disabled={disabled} onChange={event => change({ instructions: event.target.value })} /></label>
      <details className="rubric-default-guides"><summary>Default test guides</summary>
        <p className="hint">Switching scope or rubric updates a default guide automatically. A manually edited test guide is kept.</p>
        <label>Agent-only conversation default test guide<textarea rows={4} maxLength={1500} value={rubric.testGuides.conversation} disabled={disabled}
          onChange={event => change({ testGuides: { ...rubric.testGuides, conversation: event.target.value } })} /></label>
        <label>Single-speaker default test guide<textarea rows={4} maxLength={1500} value={rubric.testGuides.single} disabled={disabled}
          onChange={event => change({ testGuides: { ...rubric.testGuides, single: event.target.value } })} /></label>
        <label>Both speakers, scored separately default test guide<textarea rows={4} maxLength={1500} value={rubric.testGuides.both ?? BOTH_SPEAKERS_TEST_GUIDE} disabled={disabled}
          onChange={event => change({ testGuides: { ...rubric.testGuides, both: event.target.value } })} /></label>
      </details>
      <div className="rubric-dimensions">
        {rubric.dimensions.map(dimension => {
          const title = dimension.label.trim() || labels[dimension.id];
          function update(patch: Partial<typeof dimension>) {
            change({ dimensions: rubric.dimensions.map(item => item.id === dimension.id ? { ...item, ...patch } : item) });
          }
          return <fieldset className="rubric-dimension" key={dimension.id} disabled={disabled}>
            <legend><span className="rubric-dimension-heading">
              <input type="checkbox" aria-label={`Enable ${title}`} checked={dimension.enabled} disabled={disabled} onChange={event => update({ enabled: event.target.checked })} />
              {editing?.id === dimension.id
                ? <input aria-label={`${labels[dimension.id]} dimension name`} value={dimension.label} maxLength={80} disabled={disabled} autoFocus
                  placeholder="Dimension name" onFocus={event => event.currentTarget.select()} onChange={event => update({ label: event.target.value })} onBlur={event => {
                    const name = event.target.value.trim();
                    const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                    if (capitalized !== dimension.label) update({ label: capitalized });
                    setEditing(undefined);
                  }} onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    if (event.key === 'Escape') { event.preventDefault(); update({ label: editing.original }); setEditing(undefined); }
                  }} />
                : <button type="button" className="rubric-title-button" aria-label={`Edit ${labels[dimension.id]} dimension name`} disabled={disabled}
                  onClick={() => setEditing({ id: dimension.id, original: dimension.label })}>{title.charAt(0).toUpperCase() + title.slice(1)}</button>}
            </span></legend>
            <div className="rubric-stages">
              <label className="checkbox-label"><input type="checkbox" aria-label={`${labels[dimension.id]} Voice Selection inclusion`} checked={dimension.weights.audition > 0} disabled={!dimension.enabled}
                onChange={event => update({ weights: { ...dimension.weights, audition: event.target.checked ? 1 : 0 } })} /> Voice Selection</label>
              <label className="checkbox-label"><input type="checkbox" aria-label={`${labels[dimension.id]} TTS inclusion`} checked={dimension.weights.tts > 0} disabled={!dimension.enabled}
                onChange={event => update({ weights: { ...dimension.weights, tts: event.target.checked ? 1 : 0 } })} /> TTS</label>
            </div>
            <details><summary>Scoring description</summary><label>Criteria for {dimension.label || dimension.id}<textarea rows={3} value={dimension.description} maxLength={2000}
              onChange={event => update({ description: event.target.value })} /></label></details>
          </fieldset>;
        })}
      </div>
      {!validation.success && <p className="error-text" role="alert">{validation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' ')}</p>}
      {!canCopy && <p className="hint">Enter a different rubric name to save a new preset. The built-in default cannot be overwritten.</p>}
      {stored && stored.revision !== rubric.revision && <p className="hint" role="status">A newer preset revision is available. Select it from the list or save your snapshot as a new preset.</p>}
      <div className="button-row">
        <button className="secondary" disabled={disabled || !validation.success || !canCopy} onClick={() => onSave(rubric, true)}>Save as new preset</button>
        <button className="secondary" disabled={disabled || !validation.success || !canUpdate || !dirty} onClick={() => onSave(rubric, false)}>Save changes</button>
        <button className="text-button" disabled={disabled} onClick={onRefresh}>Refresh presets</button>
        {canUpdate && <button className="text-button danger" disabled={disabled} onClick={() => onDelete(stored)}>Delete preset</button>}
      </div>
    </details>
    {pending && <ConfirmationDialog title="Switch rubric and discard unsaved rubric edits?"
      description="Your edited rubric has not been saved as a preset. Switching replaces those rubric edits. A manually edited test guide is kept, and saved evaluations are unchanged."
      busy={busy} onCancel={() => setPending(undefined)}>
      <div className="button-row"><button className="secondary" disabled={busy} onClick={() => { select(pending); setPending(undefined); }}>Discard rubric edits and switch</button>
        <button className="secondary" data-dialog-cancel="" disabled={busy} onClick={() => setPending(undefined)}>Keep editing</button></div>
    </ConfirmationDialog>}
  </div>;
}
