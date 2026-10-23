import type { TestQueueState } from '../shared/domain';

export function TestQueue({ state, busy, onPause, onStart, onCancel }: {
  state: TestQueueState; busy: boolean; onPause: () => void; onStart: () => void; onCancel: (id: string) => void;
}) {
  if (!state.active && !state.waiting.length && !state.paused && !state.error) return null;
  return <section className="test-queue" aria-label="Test queue">
    <div className="test-queue-header">
      <strong>Test queue</strong>
      <span role="status">{state.active ? `Running: ${state.active.name}` : 'No test running'} · {state.waiting.length} waiting{state.paused ? ' · Paused' : ''}</span>
      <div className="button-row">
        {state.active && <button className="text-button danger" disabled={busy} onClick={() => onCancel(state.active!.id)}>Cancel running test</button>}
        {state.paused
          ? <button className="secondary" disabled={busy || !state.waiting.length} onClick={onStart}>Start queue</button>
          : <button className="secondary" disabled={busy} onClick={onPause}>Pause queue</button>}
      </div>
    </div>
    {state.error && <p className="error-text" role="alert">{state.error}</p>}
    {state.paused && <p className="hint">The current test can finish; waiting tests will not start. After a server restart, start the saved queue explicitly.</p>}
    {!!state.waiting.length && <details><summary>Waiting tests ({state.waiting.length})</summary>
      <ol>{state.waiting.map(test => <li key={test.id}><span title={test.name}>{test.name}</span>
        <button className="text-button danger" disabled={busy} aria-label={`Cancel queued test ${test.name}`} onClick={() => onCancel(test.id)}>Cancel</button></li>)}</ol>
    </details>}
  </section>;
}
