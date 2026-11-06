import { useState } from 'react';
import type { BatchPreview, BatchRequest, BatchTest } from '../shared/batch';
import { parseSortingPaths as parseFolderPaths } from '../shared/sorting';
import { profileSchema, settingsSchema, rolesForScope, testType, type Judge, type Profile, type Settings } from '../shared/domain';
import { batchTestProfile, submitBatch, type BatchSubmission } from './batch';

export function BatchEvaluation({ profile, config, busy, onAction, onPreview, onQueue, onRefresh }: {
  profile: Profile; config?: Settings & { configured: boolean }; busy: boolean;
  onAction: (label: string, run: () => Promise<void>) => Promise<void>;
  onPreview: (request: BatchRequest) => Promise<BatchPreview>;
  onQueue: (token: string, test: BatchTest, profile: Profile, judges: Judge[]) => Promise<{ id: string }>;
  onRefresh: () => Promise<void>;
}) {
  const [step, setStep] = useState<'settings' | 'directory'>('settings');
  const [directory, setDirectory] = useState('');
  const [sourceMode, setSourceMode] = useState<'parent' | 'list'>('parent');
  const [folderPaths, setFolderPaths] = useState('');
  const [preview, setPreview] = useState<BatchPreview>();
  const [results, setResults] = useState<BatchSubmission[]>([]);
  const [snapshot, setSnapshot] = useState<{ profile: Profile; judges: Judge[] }>();
  // Locale-dependent scoring eligibility is validated per test after folder discovery.
  const settingsReady = config?.configured && settingsSchema.safeParse(snapshot ? { judges: snapshot.judges } : config).success &&
    profileSchema.innerType().safeParse(snapshot?.profile ?? profile).success;
  const pending = preview?.tests.filter(test => !results.some(result => result.name === test.name && result.id)) ?? [];
  const sharedProfile = snapshot?.profile ?? profile;
  const errors = (test: BatchTest) => {
    const issues = [...test.errors];
    if (test.files.length * rolesForScope(sharedProfile.scope).length > 200)
      issues.push('More than 200 role/audio inputs. Split this test into smaller folders.');
    try { batchTestProfile(sharedProfile, test.name); }
    catch (error) { issues.push(error instanceof Error ? error.message : 'Invalid evaluation settings.'); }
    return issues;
  };
  const queued = results.filter(result => result.id).length;
  const directories = parseFolderPaths(folderPaths);
  function invalidatePreview() {
    setPreview(undefined); setResults([]);
  }
  return <section className="card recordings-card" aria-label="Batch evaluation wizard">
    <h2>03 · Batch evaluation wizard</h2>
    {step === 'settings' ? <>
      <p>Step 1 of 2: choose the evaluation type, who should be scored, automatic speaker selection, rubric, test guide and judging panel above.</p>
      <p className="hint">One shared settings snapshot applies to every test. Each test folder supplies its own name, locale and gender; an absent or ambiguous locale uses Auto. Gender is a label, not inferred from audio.</p>
      {!settingsReady && <p role="status">Complete the evaluation settings and configure Azure and the judging panel before continuing.</p>}
      <button className="primary" disabled={busy || !settingsReady} onClick={() => setStep('directory')}>Continue to batch directory</button>
    </> : <>
      <p>Step 2 of 2: choose a parent directory or list individual test folders. Each test folder contains voice folders → audio files.</p>
      <p className="hint">Paths refer to the computer running this app. Originals stay untouched. Supported formats: WAV, MP3, M4A, OGG, FLAC, AAC, WebM, Opus; browser codec support varies.</p>
      <label>Batch source<select value={sourceMode} disabled={busy || !!snapshot} onChange={event => {
        setSourceMode(event.target.value === 'list' ? 'list' : 'parent'); invalidatePreview();
      }}>
        <option value="parent">Parent directory</option>
        <option value="list">Test folder list</option>
      </select></label>
      {sourceMode === 'parent' ? <label>Batch parent directory<input value={directory} disabled={busy || !!snapshot} placeholder={'D:\\Evaluations'} onChange={event => {
        setDirectory(event.target.value); invalidatePreview();
      }} /></label> : <>
        <label>Test folder paths (one absolute path per line)<textarea rows={6} value={folderPaths} disabled={busy || !!snapshot}
          placeholder={'"D:\\Evaluations\\es-ES_M"\n"D:\\Other evaluations\\pt-BR Female VTS"'}
          onChange={event => { setFolderPaths(event.target.value); invalidatePreview(); }} /></label>
        <p className="hint">{directories.length} test folders entered. Paste one path per line, with or without double quotes. Spaces are preserved. Each listed folder becomes one test; its immediate subfolders are voices. Repeated paths are evaluated once; test folder names must be unique.</p>
      </>}
      <div className="button-row">
        <button className="secondary" disabled={busy || (sourceMode === 'parent' ? !directory.trim() : !directories.length)} onClick={() => void onAction('Previewing batch folders', async () => {
          const next = await onPreview(sourceMode === 'parent' ? { directory } : { directories });
          setPreview(next); setResults(previous => previous.filter(result => result.id));
        })}>Preview batch</button>
        <button className="text-button" disabled={busy || !!snapshot} onClick={() => setStep('settings')}>Back to shared settings</button>
      </div>
      {preview && <>
        <p>{preview.tests.length} tests · {preview.tests.reduce((sum, test) => sum + test.files.length, 0)} audio files · {preview.ignoredFiles} non-audio files ignored.</p>
        <p className="hint">Shared settings: {testType(sharedProfile.stage)} · {sharedProfile.scope} · automatic speaker selection · {sharedProfile.rubric?.name ?? 'Default rubric'}. Long files are split into complete listening windows; tests exceeding 200 role/audio inputs fail explicitly.</p>
        <div className="table-scroll"><table><caption>Batch preview and submission results</caption>
          <thead><tr><th>Test name</th><th>Locale</th><th>Gender</th><th>Voices</th><th>Audio files</th><th>Status</th></tr></thead>
          <tbody>{preview.tests.map(test => {
            const result = results.find(item => item.name === test.name);
            const issues = errors(test);
            return <tr key={test.name}><th scope="row">{test.name}</th><td>{test.languages.join(', ') || 'Auto'}</td><td>{test.genders.join(', ')}</td>
              <td>{new Set(test.files.map(file => file.voice)).size}</td><td>{test.files.length}</td>
              <td>{result?.id ? 'Submitted to queue' : result?.error ? <span role="alert">{result.error}</span> : issues.length ? issues.join(' ') : 'Ready'}</td></tr>;
          })}</tbody>
        </table></div>
        <p className="hint">Submitting sends the selected audio to your configured Azure resource and incurs usage charges for every test, judge and automatic retry. No separate permission confirmation is required.</p>
        <p className="hint">Keep this browser open until submission finishes. Submitted tests are saved and run one at a time through the normal queue, even if the browser closes. Keep the server running. A paused queue stays paused. Results appear in Test Reports with the usual reports and exports.</p>
        {snapshot && <p className="hint">Retries use the original shared settings snapshot. Successfully submitted tests are not submitted again. If source files change, preview these folders again. Start a new batch to use different settings or folders.</p>}
        <div className="button-row">
          <button className="primary" disabled={busy || !settingsReady || !pending.length || pending.some(test => errors(test).length > 0)} onClick={() => void onAction('Submitting batch evaluations', async () => {
            if (!config) throw new Error('Wait for Azure settings to load.');
            const settings = snapshot ?? structuredClone({ profile, judges: config.judges });
            setSnapshot(settings);
            await submitBatch(pending, settings.profile, settings.judges,
              (test, evaluation, judges) => onQueue(preview.token, test, evaluation, judges),
              result => setResults(previous => [...previous.filter(item => item.name !== result.name), result]));
            await onRefresh();
          })}>{results.length ? 'Submit remaining tests' : 'Submit all to queue'}</button>
          <button className="secondary" disabled={busy} onClick={() => {
            setPreview(undefined); setResults([]); setSnapshot(undefined); setStep('settings');
          }}>Start a new batch</button>
        </div>
        {!!results.length && <p role="status">{queued} submitted · {results.filter(result => result.error).length} failed. Failed tests remain available for retry; no successful test is resubmitted.</p>}
      </>}
    </>}
  </section>;
}
