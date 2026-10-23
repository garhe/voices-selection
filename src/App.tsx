import { useEffect, useRef, useState } from 'react';
import {
  type Dimension, type Job, type Profile, type Settings, type Summary, type ConnectionStatus, type ConnectionTest, type EvidenceNote, type VoiceEvidence, type DraftClip, type StoredClip, type TestQueueState,
  dimensions, labels, voiceDimensionGuidance, RUBRIC_VERSION, summarize, summarizeVoiceEvidence, assessmentGaps, eligibleScore, retryableAudioIssue, MAX_SECONDS, activeDimensions, evaluationName, testNameSchema, languageHintSchema, resolveLanguageHint, rolesForScope,
} from '../shared/domain';
import { automaticRegions, base64, browserWav, decode, toPcm, validateRegion, type Recording, type Region } from './audio';
import { applyLanguageHint, evaluationBlockers, inputCount, recordingReviewed, withLanguageAccent, withTestNameLanguage, DEFAULT_TEST_GUIDE } from './readiness';
import { voiceDirectorBriefs, formatDirectorBrief, type VoiceDirectorBrief } from '../shared/coaching';
import { canManageTest, testHistory, testMetadataSchema, testNameMetadata, type BulkTestAction, type BulkTestResult, type TestHistory } from '../shared/history';
import { TestLibrary, TestMetadataEditor, type ReportKind } from './TestLibrary';
import { TestQueue } from './TestQueue';
import { ConfirmationDialog } from './ConfirmationDialog';

type Config = Settings & ConnectionStatus & { rubric: string; runtimeError?: string };
type History = TestHistory;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error.';
const score = (n: number | null | undefined) => n == null ? 'Not assessed' : n.toFixed(2);
async function api<T>(url: string, body?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, body === undefined ? { signal, method: method === 'POST' ? 'GET' : method } : {
    method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try { detail = (JSON.parse(text) as { error?: string }).error || text; }
    catch { detail = `HTTP ${response.status}: ${text.slice(0, 250)}`; }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}
async function loadHistory(): Promise<History[]> {
  const entries = await api<History[]>('/api/jobs');
  if (entries.some(entry => !Array.isArray(entry.languages) || !Array.isArray(entry.voices) || !Array.isArray(entry.genders)))
    throw new Error('The server is using an older test-list format. Restart Voices Selection, then refresh this page.');
  return entries.map(entry => ({ ...entry, ...testNameMetadata(entry.name) }));
}
function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportReportJson(job: Job) {
  download(`voice-evaluation-${job.id}.json`, JSON.stringify({
    ...job, name: evaluationName(job), summary: summarize(job), voiceEvidence: summarizeVoiceEvidence(job),
    improvementGuidance: voiceDirectorBriefs(job),
  }, null, 2), 'application/json');
}
function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function exportCsv(job: Job) {
  const rows: unknown[][] = [[
    'test_name', 'evaluation_id', 'created_at', 'voice', 'file', 'role', 'start_seconds', 'end_seconds', 'channel', 'judge', 'deployment', 'reported_model',
    'stage', 'speaker_mode', 'rubric', 'language_hint', 'input_language_hint', 'target_market', 'status', 'response_format', 'language', 'language_supported', 'assessable', 'preference_score',
    'role_attribution_status', 'role_attribution_evidence',
    ...dimensions, 'error', 'observations', 'limitations', 'dimension_reasons', 'audio_diagnostics', 'previous_evaluations',
  ]];
  for (const r of job.results) {
    const clip = job.clips.find(c => c.id === r.clipId)!;
    const judge = job.judges.find(j => j.id === r.judgeId)!;
    rows.push([
      evaluationName(job), job.id, job.createdAt, clip.voice, clip.file, clip.role, clip.start, clip.end, clip.channel, judge.name, judge.deployment, r.model,
      job.profile.stage, job.profile.speakerMode ?? 'manual', job.rubric, job.profile.language, clip.language, job.profile.targetMarket, r.status, r.responseFormat, r.assessment?.language, r.assessment?.languageSupported,
      r.assessment?.assessable, r.assessment ? eligibleScore(r.assessment, job.profile) : null,
      r.assessment?.speakerAttribution?.status, r.assessment?.speakerAttribution?.evidence,
      ...dimensions.map(d => r.assessment?.scores[d]), r.error,
      r.assessment?.observations.join(' | '), r.assessment?.limitations.join(' | '), JSON.stringify(r.assessment?.reasons),
      JSON.stringify(r.audioDiagnostics), JSON.stringify(r.previousEvaluations),
    ]);
  }
  download(`voice-assessments-${job.id}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportVoiceEvidenceCsv(job: Job) {
  const rows: unknown[][] = [[
    'test_name', 'evaluation_id', 'rubric', 'language_hint', 'target_market', 'voice', 'role', 'judge', 'deployment', 'full_panel_eligible_files', 'total_files',
    'judge_scored_files', 'section', 'dimension', 'dimension_score', 'diagnostic_only', 'recording_count', 'files', 'comment',
  ]];
  for (const voice of summarizeVoiceEvidence(job)) for (const evidence of voice.judges) {
    const judge = job.judges.find(j => j.id === evidence.judgeId)!;
    const row = (section: string, note?: EvidenceNote, dimension?: Dimension, value?: number | null, diagnostic?: boolean) => rows.push([
      evaluationName(job), job.id, job.rubric, job.profile.language, job.profile.targetMarket, voice.voice, voice.role, judge.name, judge.deployment, voice.eligibleFiles, voice.files,
      evidence.scoredFiles, section, dimension, value, diagnostic, note?.files.length, note?.files.join(' | '), note?.text,
    ]);
    row('coverage');
    for (const section of ['gaps', 'observations', 'limitations'] as const)
      for (const note of evidence[section]) row(section, note);
    for (const dimension of evidence.dimensions) {
      row('dimension_summary', undefined, dimension.dimension, dimension.score, dimension.diagnostic);
      for (const note of dimension.reasons) row('dimension_evidence', note, dimension.dimension, dimension.score, dimension.diagnostic);
    }
  }
  download(`voice-evidence-${job.id}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function EvidenceList({ notes }: { notes: EvidenceNote[] }) {
  return <ul>{notes.map(note => <li key={note.text}>{note.text}<small className="evidence-files">{note.files.length} recording{note.files.length === 1 ? '' : 's'} · {note.files.join(' · ')}</small></li>)}</ul>;
}
function exportVoiceMatrixCsv(job: Job) {
  const notes = (values: EvidenceNote[]) => values.length ? values.map(note =>
    `${note.text}\nSource recordings (${note.files.length}): ${note.files.join(' | ')}`).join('\n\n') : 'None recorded.';
  const rows: unknown[][] = [[
    'test_name', 'evaluation_id', 'rubric', 'language_hint', 'target_market', 'voice', 'role', 'panel_preference_score', 'panel_eligible_files', 'total_files',
    ...job.judges.map(judge => `${judge.name} (${judge.deployment})`),
  ]];
  for (const voice of summarizeVoiceEvidence(job)) rows.push([
    evaluationName(job), job.id, job.rubric, job.profile.language, job.profile.targetMarket, voice.voice, voice.role, voice.score, voice.eligibleFiles, voice.files,
    ...voice.judges.map(judge => [
      `Single-judge preference (1-5): ${score(judge.score)}`,
      `Scored recordings: ${judge.scoredFiles}/${voice.files}`,
      `OVERALL COMMENTS:\n${notes(judge.observations)}`,
      `LIMITATIONS:\n${notes(judge.limitations)}`,
      `SCORING GAPS:\n${notes(judge.gaps)}`,
      `DIMENSION RATINGS & ORIGINAL REASONS:\n${judge.dimensions.map(d =>
        `${labels[d.dimension]}: ${score(d.score)}${d.diagnostic ? ' (diagnostic only; excluded from preference)' : ''}\n${notes(d.reasons)}`).join('\n\n')}`,
      'Saved evidence only. Scores use eligible recordings; comments may also come from excluded recordings. No new verdict or pros/cons classification.',
    ].join('\n\n')),
  ]);
  download(`voice-judge-matrix-${job.id}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function VoiceJudgeMatrix({ job, voices }: { job: Job; voices: VoiceEvidence[] }) {
  return <section className="card voice-matrix">
    <div className="section-with-action"><h2>Judge comments matrix</h2><button className="secondary" onClick={() => exportVoiceMatrixCsv(job)}>Export matrix CSV</button></div>
    <p className="hint">Rows are voices and roles; columns are judges. These are original comments about strengths and concerns, not newly inferred pros/cons or a synthesized verdict. The first two overall comments are shown by recording frequency, then alphabetically; expand for the rest.</p>
    <p className="hint">Scores use eligible recordings only. Comments can also come from excluded recordings; each lists its sources. Single-judge scores are not full-panel scores. Incomplete recording coverage limits comparisons. This view follows the language filter; the CSV exports the complete evaluation with all comments and reasons.</p>
    <div className="table-scroll matrix-scroll" tabIndex={0} role="region" aria-label="Scrollable judge comments matrix">
      <table><caption>{evaluationName(job)} · Saved-evidence report · Scores out of 5, not MOS</caption>
        <thead><tr><th scope="col">Voice / role</th><th scope="col">Full-panel preference</th>{job.judges.map(judge => <th scope="col" key={judge.id}>{judge.name}<small>{judge.deployment}</small></th>)}</tr></thead>
        <tbody>{voices.map(voice => <tr key={JSON.stringify([voice.voice, voice.role])}>
          <th scope="row"><strong>{voice.voice}</strong><small>{voice.role}</small></th>
          <td><strong>{score(voice.score)}{voice.score !== null && ' / 5'}</strong><small>{voice.eligibleFiles}/{voice.files} eligible recordings</small>{voice.eligibleFiles < voice.files && <p className="hint">Incomplete coverage</p>}</td>
          {voice.judges.map(judge => <td key={judge.judgeId}>
            <p><strong>{score(judge.score)}{judge.score !== null && ' / 5'}</strong><small>Single-judge preference · {judge.scoredFiles}/{voice.files} recordings scored</small></p>
            <h3>Overall comments</h3>
            {judge.observations.length ? <EvidenceList notes={judge.observations.slice(0, 2)} /> : <p>No overall comments recorded.</p>}
            {judge.observations.length > 2 && <details><summary>More overall comments ({judge.observations.length - 2})</summary><EvidenceList notes={judge.observations.slice(2)} /></details>}
            <details><summary>Limitations ({judge.limitations.length})</summary>{judge.limitations.length ? <EvidenceList notes={judge.limitations} /> : <p>No limitations recorded.</p>}</details>
            <details open={judge.gaps.length > 0}><summary>Scoring gaps ({judge.gaps.length})</summary>{judge.gaps.length ? <EvidenceList notes={judge.gaps} /> : <p>No scoring gaps reported.</p>}</details>
            <h3>Dimension ratings</h3><ul className="matrix-ratings">{judge.dimensions.map(d => <li key={d.dimension}>{labels[d.dimension]}: <strong>{score(d.score)}</strong>{d.diagnostic && <small>Diagnostic only; excluded from preference</small>}</li>)}</ul>
            <details><summary>Why these ratings</summary>{judge.dimensions.map(d => <div key={d.dimension}><h4>{labels[d.dimension]} · {score(d.score)}{d.diagnostic && ' (diagnostic only)'}</h4>{d.reasons.length ? <EvidenceList notes={d.reasons} /> : <p>No scored evidence available; check scoring gaps.</p>}</div>)}</details>
          </td>)}
        </tr>)}
          {!voices.length && <tr><td colSpan={job.judges.length + 2}>No recordings match this filter yet. Language filtering requires agreement across the full judge panel.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
function exportCoachingCsv(job: Job) {
  const rows: unknown[][] = [[
    'test_name', 'rubric', 'language_hint', 'voice', 'role', 'director_summary', 'keep_doing', 'delivery_target', 'target_market',
    'focus', 'performance_direction', 'practice_steps', 'listening_check', 'next_take_plan', 'before_you_send', 'brief_notes',
    'recording_cases', 'saved_recording_feedback',
  ]];
  for (const voice of voiceDirectorBriefs(job)) {
    const common = [
      evaluationName(job), job.rubric, job.profile.language, voice.voice, voice.role, voice.summary, voice.keep.join('\n'), voice.deliveryTarget, voice.targetMarket,
    ];
    for (const focus of voice.focus.length ? voice.focus : [undefined]) rows.push([
      ...common, focus?.title, focus?.direction, focus?.steps.join('\n'), focus?.check,
      voice.takePlan.join('\n'), voice.checklist.join('\n'), voice.notes.join('\n'),
      focus?.cases.map(item => `${item.recording} (${item.start}-${item.end}s)\nFind: ${item.cue}\nHeard: ${item.observation}\nDo: ${item.direction}\nPass check: ${item.check}`).join('\n\n'),
      focus?.feedback.map(item => `${item.recording} (${item.start}-${item.end}s): ${item.observation}`).join('\n'),
    ]);
  }
  download(`voice-improvement-guidance-${job.id}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function VoiceImprovement({ job, voices }: { job: Job; voices: VoiceDirectorBrief[] }) {
  return <section className="card voice-coaching">
    <div className="section-with-action"><h2>Voice director: your next take</h2><button className="secondary" onClick={() => exportCoachingCsv(job)}>Export improvement CSV</button></div>
    <p className="hint">Start with a recording case: find the cue, listen for the reported sound, then try the exact adjustment and pass check. Keep the words unchanged. Older feedback without an exact cue is labeled below; run a new evaluation for specific directions. These notes use existing feedback, not a new listening session.</p>
    {!voices.length && <p>No recordings match this filter yet.</p>}
    {voices.map(voice => <details key={JSON.stringify([voice.voice, voice.role])}>
      <summary><strong>{voice.voice} / {voice.role}</strong> · {voice.status === 'insufficient_feedback' ? 'More feedback needed' : voice.focus.length ? `${voice.focus.length} focus areas` : 'Consistency take'}</summary>
      <button className="secondary" onClick={() => download(`next-take-${voice.voice.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-${voice.role}.txt`, formatDirectorBrief(voice), 'text/plain;charset=utf-8')}>Download next-take brief</button>
      <h3>Director summary</h3><p className="director-note">{voice.summary}</p>
      {voice.keep.length > 0 && <><h3>Keep doing</h3><ul>{voice.keep.map(line => <li key={line}>{line}</li>)}</ul></>}
      {voice.deliveryTarget && <p><strong>Requested delivery style:</strong> {voice.deliveryTarget}</p>}
      {voice.targetMarket && <p><strong>Market / accent target:</strong> {voice.targetMarket}</p>}
      {voice.focus.map((focus, index) => <article key={focus.dimension}>
        <h3>{index + 1}. {focus.title}</h3><p>{focus.direction}</p>
        {focus.cases.map((item, caseIndex) => <div className="callout" key={caseIndex}>
          <h4>Case {caseIndex + 1}: {item.recording} ({item.start}-{item.end}s excerpt)</h4>
          <p><strong>Find:</strong> {item.cue}</p>
          <p><strong>Heard:</strong> {item.observation}</p>
          <p><strong>Do:</strong> {item.direction}</p>
          <p><strong>Pass check:</strong> {item.check}</p>
        </div>)}
        {focus.feedback.length > 0 && <div className="callout">
          <h4>Saved feedback - exact direction not available</h4>
          {focus.feedback.map((item, feedbackIndex) => <p key={feedbackIndex}><strong>{item.recording} ({item.start}-{item.end}s):</strong> {item.observation}</p>)}
        </div>}
        <h4>Try this</h4><ol>{focus.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <p><strong>Listen for:</strong> {focus.check}</p>
      </article>)}
      <h3>Your next three takes</h3><ol>{voice.takePlan.map(take => <li key={take}>{take}</li>)}</ol>
      <h3>Before you send</h3><ul>{voice.checklist.map(line => <li key={line}>{line}</li>)}</ul>
      <div className="callout">{voice.notes.map(note => <p key={note}>{note}</p>)}</div>
    </details>)}
  </section>;
}
function Waveform({ buffer, regions }: { buffer: AudioBuffer; regions: Region[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const samples = buffer.getChannelData(0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f766e';
    for (let x = 0; x < canvas.width; x++) {
      const start = Math.floor(x * samples.length / canvas.width);
      const end = Math.max(start + 1, Math.floor((x + 1) * samples.length / canvas.width));
      let peak = 0;
      for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
      const height = Math.max(1, peak * 72);
      ctx.fillRect(x, (canvas.height - height) / 2, 1, height);
    }
    regions.forEach((r, i) => {
      ctx.fillStyle = i % 2 ? '#f59e0b35' : '#0f766e25';
      ctx.fillRect(r.start / buffer.duration * canvas.width, 0, (r.end - r.start) / buffer.duration * canvas.width, canvas.height);
    });
  }, [buffer, regions]);
  return <canvas ref={ref} width={900} height={88} className="waveform" aria-label="First-channel waveform with selected regions shaded" role="img" />;
}

function AzureConnection({ config, busy, onAction, onSaved }: {
  config: Config; busy: boolean;
  onAction: (label: string, fn: () => Promise<void>) => Promise<void>;
  onSaved: (status: ConnectionStatus) => void;
}) {
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [tests, setTests] = useState<ConnectionTest[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setEndpoint(config.endpoint); }, [config.endpoint]);
  const panelSignature = JSON.stringify(config.judges);
  useEffect(() => { setTests([]); }, [endpoint, apiKey, panelSignature]);
  const unsaved = endpoint.trim().replace(/\/$/, '') !== config.endpoint.replace(/\/$/, '') || !!apiKey;
  const endpointModel = URL.canParse(endpoint) ? new URL(endpoint).searchParams.get('model') : null;
  const detectedDeployment = endpointModel && /^[a-zA-Z0-9._-]{1,120}$/.test(endpointModel) ? endpointModel : null;
  return <div className="azure-connection">
    <div className="section-with-action"><h3>Azure connection</h3><span className="pill">{config.configured ? 'Credentials configured' : 'Setup required'}</span></div>
    <p className="hint">Paste the HTTPS resource address or the full wss:// endpoint from Foundry's deployment Details page. All judges use this resource; the key goes in its own field.</p>
    <label>Azure resource endpoint<input type="url" value={endpoint} disabled={busy} maxLength={300} spellCheck={false} placeholder="https://your-resource.openai.azure.com" onChange={e => { setEndpoint(e.target.value); setMessage(''); }} /></label>
    {detectedDeployment && <p className="hint">Detected deployment: <strong>{detectedDeployment}</strong>. Enter this name in one judge's deployment field; other judges keep their own deployment names.</p>}
    <label>Azure API key<input type="password" name="azure-api-key" value={apiKey} disabled={busy} maxLength={512} autoComplete="new-password" spellCheck={false} placeholder={config.keyStored ? 'Key configured — leave blank to keep it' : 'Paste Key 1 or Key 2'} onChange={e => { setApiKey(e.target.value); setMessage(''); }} /></label>
    <p className="hint">{config.secureStorageAvailable
      ? 'Saved keys are encrypted for your Windows account on the backend, never returned to the browser or included in exports.'
      : 'Saving keys from the UI requires Windows. On this system, configure credentials through environment variables.'}
      {config.connectionSource === 'environment' && ' Currently using environment/.env credentials.'}</p>
    <div className="button-row">
      <button className="secondary" disabled={busy || !config.secureStorageAvailable || !endpoint.trim() || (!config.keyStored && !apiKey.trim())} onClick={() => void onAction('Saving Azure connection', async () => {
        const status = await api<ConnectionStatus>('/api/connection', { endpoint, apiKey }, 'PUT');
        setApiKey(''); setTests([]); setConfirmRemove(false); onSaved(status);
        setMessage(`Connection saved. Ready to use without restarting the server.${detectedDeployment ? ` Use "${detectedDeployment}" in one judge's deployment field.` : ''}`);
      })}>Save connection</button>
      <button className="text-button" disabled={busy || !config.configured || unsaved} title={unsaved ? 'Save your connection changes first' : 'Check the current deployment names using the saved connection'} onClick={() => void onAction('Testing Azure judge connections', async () => {
        setTests([]); setMessage('');
        const result = await api<{ results: ConnectionTest[] }>('/api/connection/test', { judges: config.judges });
        setTests(result.results);
      })}>Test judge connections</button>
    </div>
    {unsaved && <p className="hint">Save connection changes before testing. Enter a new key when changing the Azure resource.</p>}
    {message && <p className="connection-success" role="status">{message}</p>}
    {!!tests.length && <div className="connection-tests" role="status">{tests.map(test => {
      const judge = config.judges.find(j => j.id === test.judgeId);
      return <div key={test.judgeId} className={test.ok ? 'connection-pass' : 'connection-fail'}>
        <strong>{judge?.name}: {test.ok ? 'Connected' : 'Failed'}</strong>
        <small>{test.ok ? `${judge?.deployment}${test.model ? ` · ${test.model}` : ''} · audio / assessment-function configuration accepted` : test.error}</small>
      </div>;
    })}</div>}
    <p className="hint">The test checks audio and required assessment-function configuration for these deployments; it sends no recordings or evaluation prompts and generates no response. It does not prove the model will return valid arguments or accurate ratings. Service billing policies still apply.</p>
    {config.connectionSource === 'saved' && <div className="connection-remove">
      {!confirmRemove ? <button className="text-button danger" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove saved connection</button> : <>
        <p className="hint">Remove the saved endpoint and encrypted key? Environment/.env settings will be used if present. Active evaluations keep their original connection.</p>
        <div className="button-row"><button className="secondary danger" disabled={busy} onClick={() => void onAction('Removing saved connection', async () => {
          const status = await api<ConnectionStatus>('/api/connection', {}, 'DELETE');
          setApiKey(''); setTests([]); setConfirmRemove(false); onSaved(status);
          setMessage('Saved connection removed.');
        })}>Confirm removal</button><button className="text-button" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep connection</button></div>
      </>}
    </div>}
  </div>;
}

export function App() {
  const [tab, setTab] = useState<'setup' | 'results'>('setup');
  const [testName, setTestName] = useState('');
  const [profile, setProfile] = useState<Profile>({ stage: 'audition', scope: 'agent', speakerMode: 'automatic', target: DEFAULT_TEST_GUIDE, language: 'auto', targetMarket: '' });
  const [config, setConfig] = useState<Config>();
  const [records, setRecords] = useState<Recording[]>([]);
  const [savedClips, setSavedClips] = useState<DraftClip[]>();
  const [draftSource, setDraftSource] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<History>();
  const [confirmAction, setConfirmAction] = useState<{
    title: string; description: string; label: string; status: string; run: () => Promise<void>;
  }>();
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState<{ action: BulkTestAction; entries: History[] }>();
  const [bulkConsent, setBulkConsent] = useState(false);
  const [bulkReport, setBulkReport] = useState<{ action: BulkTestAction; result: BulkTestResult; names: Map<string, string> }>();
  const [selected, setSelected] = useState<string>();
  const [buffer, setBuffer] = useState<AudioBuffer>();
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [history, setHistory] = useState<History[]>([]);
  const [job, setJob] = useState<Job>();
  const [queue, setQueue] = useState<TestQueueState>();
  const [showTestList, setShowTestList] = useState(true);
  const [editingTest, setEditingTest] = useState<Job>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [consent, setConsent] = useState(false);
  const [languageFilter, setLanguageFilter] = useState('all');
  const folder = useRef<HTMLInputElement>(null);
  const recordingsSection = useRef<HTMLElement>(null);
  const current = records.find(r => r.id === selected);
  const currentFile = current?.file;
  const included = records.filter(r => r.include);
  const voiceCount = new Set(included.map(r => r.voice)).size;
  const confirmed = included.filter(r => recordingReviewed(r, profile.scope)).length;
  const busyRef = useRef(false);
  async function action(label: string, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setNotice('');
    try { await fn(); }
    catch (error) { setNotice(errorText(error)); }
    finally { busyRef.current = false; setBusy(''); }
  }
  async function refresh() {
    const [configuration, list, queueState] = await Promise.all([api<Config>('/api/config'), loadHistory(), api<TestQueueState>('/api/queue')]);
    setConfig(configuration); setHistory(list); setQueue(queueState);
    if (configuration.runtimeError) setNotice(configuration.runtimeError);
  }
  useEffect(() => {
    void refresh().catch(error => setNotice(errorText(error)));
  }, []);
  useEffect(() => {
    const eligible = new Set(history.filter(canManageTest).map(entry => entry.id));
    setSelectedTestIds(previous => {
      const next = previous.filter(id => eligible.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [history]);
  useEffect(() => {
    let stopped = false, pending = false;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (stopped || pending) return;
      pending = true;
      void Promise.all([api<TestQueueState>('/api/queue', undefined, 'GET', controller.signal), loadHistory()]).then(([state, list]) => {
        if (!stopped) { setQueue(state); setHistory(list); }
      }).catch(error => {
        if (!stopped) { setNotice(`Queue polling stopped: ${errorText(error)}. Refresh the page to reconnect.`); stopped = true; }
      }).finally(() => { pending = false; });
    }, 2000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!currentFile) { setBuffer(undefined); setSourceUrl(''); setPreviewUrl(''); return; }
    let cancelled = false;
    const url = URL.createObjectURL(currentFile); setSourceUrl(url); setBuffer(undefined); setPreviewUrl('');
    void decode(currentFile).then(decoded => {
      if (cancelled) return;
      setBuffer(decoded);
      setRecords(previous => previous.map(r => r.id !== selected ? r : {
        ...r, duration: decoded.duration, channels: decoded.numberOfChannels,
        regions: r.regions.length ? r.regions : defaultRegions(profile.scope, decoded.duration),
      }));
    }).catch(error => { if (!cancelled) setNotice(`Cannot decode ${currentFile.name}: ${errorText(error)}. Try a PCM WAV file.`); });
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [currentFile, selected, profile.scope]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (!job || !['running', 'queued'].includes(job.status)) return;
    let stopped = false, pending = false;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (stopped || pending) return;
      pending = true;
      void api<Job>(`/api/jobs/${job.id}`, undefined, 'GET', controller.signal).then(value => {
        if (!stopped) {
          setJob(value);
          setHistory(previous => previous.map(entry => entry.id === value.id ? testHistory(value) : entry));
        }
      }).catch(error => {
        if (!stopped) { setNotice(`Progress polling stopped: ${errorText(error)}. Use Refresh results.`); stopped = true; }
      }).finally(() => { pending = false; });
    }, 1500);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (job && job.status !== 'running') void loadHistory().then(setHistory).catch(error => setNotice(errorText(error)));
  }, [job?.id, job?.status]);
  function defaultRegions(scope: Profile['scope'], duration: number): Region[] {
    const roles = rolesForScope(scope);
    return roles.map(role => ({ id: crypto.randomUUID(), role, start: 0, end: Math.min(duration, MAX_SECONDS), channel: 'mix', confirmed: false }));
  }
  function updateRecording(id: string, patch: Partial<Recording>) {
    setRecords(previous => previous.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function beginNewEvaluation() {
    if (tab === 'setup') return;
    setProfile(withTestNameLanguage({ ...(job?.profile ?? profile), target: DEFAULT_TEST_GUIDE }, ''));
    if (job) setConfig(previous => previous ? { ...previous, judges: job.judges.map(judge => ({ ...judge })) } : previous);
    setTestName(''); setRecords([]); setSavedClips(undefined); setDraftSource(undefined);
    setSelected(undefined); setBuffer(undefined); setSourceUrl(''); setPreviewUrl('');
    setConsent(false); setConfirmDelete(undefined); setTab('setup');
    setEditingTest(undefined);
    setNotice('New test draft ready. Previous evaluation settings are kept; recordings and audio permission are cleared. Enter a test name and select a folder. Saved results are unchanged.');
  }
  function applyLanguageToAll() {
    const language = languageHintSchema.parse(profile.language);
    setProfile(previous => withLanguageAccent(previous, language));
    setRecords(previous => applyLanguageHint(previous, language));
    setSavedClips(previous => previous === undefined ? undefined : applyLanguageHint(previous, language));
    setNotice(`Language/accent "${language}" applied to all ${savedClips?.length ?? records.length} ${savedClips ? 'saved audio inputs' : 'recordings'}, including excluded inputs. Individual listening-hint overrides remain editable. Saved evaluations are unchanged.`);
  }
  function updateRegion(id: string, patch: Partial<Region>) {
    if (!current) return;
    setPreviewUrl('');
    updateRecording(current.id, { regions: current.regions.map(r => r.id === id ? { ...r, ...patch, confirmed: false } : r) });
  }
  function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const audio = [...files].filter(f => /\.(wav|mp3|m4a|ogg|flac|aac|webm|opus)$/i.test(f.name));
    if (!audio.length) { setNotice('No supported audio filenames found. Try WAV, MP3, M4A, OGG, FLAC or WebM.'); return; }
    if (audio.length > 200 || audio.some(f => f.size > 100 * 1024 * 1024)) {
      setNotice('Import up to 200 recordings, each no larger than 100 MB.'); return;
    }
    const entries = audio.map(file => {
      const relative = file.webkitRelativePath || file.name;
      const parts = relative.split('/');
      return {
        id: crypto.randomUUID(), file, path: relative, voice: parts.length >= 3 ? parts[1] : 'Ungrouped',
        regions: [], language: 'auto', include: true,
      };
    });
    setSavedClips(undefined); setDraftSource(undefined);
    setBuffer(undefined); setSourceUrl(''); setPreviewUrl(''); setConsent(false);
    setRecords(entries); setSelected(entries[0].id);
    setNotice(`${entries.length} recordings loaded, replacing the previous draft inputs. ${entries.some(e => e.voice === 'Ungrouped') ? 'Files directly in the parent folder are grouped as Ungrouped. Voice subfolders are recommended. ' : ''}Saved evaluations are unchanged. Audio permission must be granted for this selection.`);
  }
  async function confirmRegions() {
    if (!current || !buffer) throw new Error('Load the recording first.');
    for (const region of current.regions) validateRegion(region, buffer.duration, buffer.numberOfChannels);
    const roles = rolesForScope(profile.scope);
    if (roles.some(role => !current.regions.some(r => r.role === role))) throw new Error('Add a region for every selected role.');
    for (const role of roles) {
      const ordered = current.regions.filter(r => r.role === role).sort((a, b) => a.start - b.start);
      if (ordered.some((r, i) => i > 0 && r.start < ordered[i - 1].end)) throw new Error('Regions for the same role must not overlap.');
    }
    updateRecording(current.id, { regions: current.regions.map(r => ({ ...r, confirmed: true })) });
  }
  async function start(enqueue = false) {
    const blockers = enqueue ? queueBlockers : startBlockers;
    if (blockers.length) throw new Error(blockers.join(' '));
    const name = testNameSchema.parse(testName);
    if (!config?.configured) throw new Error('Save your Azure endpoint and API key in the Azure connection settings first.');
    await api('/api/settings', { judges: config.judges }, 'PUT');
    const selectedClips = savedClips?.filter(c => c.include);
    const clipIds: string[] = selectedClips?.map(c => c.id) ?? [];
    for (let index = 0; index < included.length; index++) {
      const recording = included[index];
      setBusy(`Preparing ${index + 1}/${included.length}: ${recording.file.name}`);
      const audio = await decode(recording.file);
      const regions = profile.speakerMode === 'automatic' ? automaticRegions(audio.duration, profile.scope) : recording.regions;
      if (clipIds.length + regions.length > 200) throw new Error('The complete recordings require more than 200 role/audio inputs. Include fewer files in this evaluation; no audio is silently truncated.');
      for (const region of regions) {
        const id = crypto.randomUUID();
        await api('/api/clips', {
          clip: {
            id, voice: recording.voice, file: recording.path, role: region.role, start: region.start, end: region.end,
            channel: region.channel, language: resolveLanguageHint(recording.language, profile.language),
          },
          pcm: base64(await toPcm(audio, region)),
        });
        clipIds.push(id);
      }
    }
    const value = await api<Job>('/api/jobs', {
      name, profile, clipIds, consent: true, enqueue, judges: config.judges,
      clipOverrides: selectedClips?.map(c => ({ id: c.id, voice: c.voice, language: resolveLanguageHint(c.language, profile.language) })),
    });
    if (enqueue) {
      setTestName(''); setRecords([]); setSelected(undefined); setSavedClips(undefined); setDraftSource(undefined); setConsent(false);
      setProfile(previous => withTestNameLanguage({ ...previous, target: DEFAULT_TEST_GUIDE }, ''));
      setNotice(`"${name}" added to the queue. Prepare the next test; saved tests run one at a time, even if this browser is closed. Keep the server running.`);
    } else {
      setJob(value); setShowTestList(false); setLanguageFilter('all'); setTab('results');
    }
    await refresh();
  }
  async function reuseEvaluation(source: Job) {
    const draft = await api<{ job: Job; clips: StoredClip[]; missing: number }>(`/api/jobs/${source.id}/draft`);
    setTestName(evaluationName(draft.job)); setProfile(withLanguageAccent(draft.job.profile));
    setConfig(previous => previous ? { ...previous, judges: draft.job.judges.map(j => ({ ...j })) } : previous);
    setRecords([]); setSelected(undefined); setSavedClips(draft.clips.map(c => ({ ...c, include: true })));
    setDraftSource(evaluationName(draft.job)); setConsent(false); setTab('setup');
    setEditingTest(undefined);
    setNotice(draft.missing
      ? `${draft.missing} saved audio input(s) are missing. Only available audio was copied; re-import originals if needed.`
      : 'Editable draft created. The combined language/accent field uses the previous accent target when supplied; review it before starting. Authorize the audio to create a new evaluation. Saved results are unchanged.');
  }
  function requestReuseEvaluation(source: Job) {
    setNotice('');
    if (records.length || savedClips) setConfirmAction({
      title: 'Replace the current setup draft?', description: 'Copy this evaluation into the setup workspace? The current draft will be replaced. Saved results will not change.',
      label: 'Replace draft', status: 'Creating editable draft', run: () => reuseEvaluation(source),
    });
    else void action('Creating editable draft', () => reuseEvaluation(source));
  }
  async function deleteEvaluation(entry: History) {
    await api(`/api/jobs/${entry.id}`, undefined, 'DELETE');
    setHistory(previous => previous.filter(h => h.id !== entry.id));
    if (job?.id === entry.id) { setJob(undefined); setShowTestList(true); setLanguageFilter('all'); }
    if (editingTest?.id === entry.id) setEditingTest(undefined);
    setConfirmDelete(undefined);
    setNotice('Evaluation deleted from history. Shared saved audio and your setup draft were kept.');
  }
  async function bulkAction() {
    if (!confirmBulk) throw new Error('Choose tests and a bulk action first.');
    const { action: operation, entries } = confirmBulk;
    if (operation === 'redo' && !bulkConsent) throw new Error('Authorize the Azure usage before redoing tests.');
    const result = await api<BulkTestResult>('/api/jobs/bulk', {
      action: operation, ids: entries.map(entry => entry.id), ...(operation === 'redo' ? { consent: true } : {}),
    });
    const succeeded = new Set(result.succeeded.map(entry => entry.id));
    setSelectedTestIds(previous => previous.filter(id => !succeeded.has(id)));
    if (operation === 'delete') {
      setHistory(previous => previous.filter(entry => !succeeded.has(entry.id)));
      if (job && succeeded.has(job.id)) { setJob(undefined); setShowTestList(true); setLanguageFilter('all'); }
      if (editingTest && succeeded.has(editingTest.id)) setEditingTest(undefined);
    }
    setBulkReport({ action: operation, result, names: new Map(entries.map(entry => [entry.id, entry.name])) });
    setConfirmBulk(undefined); setBulkConsent(false);
    await refresh();
  }
  async function openTest(entry: History, regenerate = false) {
    const value = await api<Job>(`/api/jobs/${entry.id}`);
    setJob(value); setShowTestList(false); setLanguageFilter('all'); setTab('results'); setEditingTest(undefined);
    window.scrollTo({ top: 0 });
    setHistory(previous => previous.map(item => item.id === value.id ? testHistory(value) : item));
    if (regenerate) setNotice('Reports regenerated locally from the saved assessments. All summaries, evidence and next-take briefs use the current report logic. No audio was resent, no Azure usage was incurred, and the original assessments are unchanged.');
  }
  async function downloadReports(entry: History, kind: ReportKind) {
    const value = await api<Job>(`/api/jobs/${entry.id}`);
    if (kind === 'json') exportReportJson(value);
    else if (kind === 'assessments') exportCsv(value);
    else if (kind === 'voices') exportVoiceEvidenceCsv(value);
    else exportCoachingCsv(value);
  }
  const filteredJob = job && languageFilter !== 'all' ? {
    ...job,
    clips: job.clips.filter(c => {
      const results = job.results.filter(r => r.clipId === c.id && r.assessment);
      return results.length === job.judges.length && results.every(r => r.assessment?.language.toLowerCase() === languageFilter.toLowerCase());
    }),
  } : job;
  const summary = filteredJob ? summarize(filteredJob) : [];
  const voiceEvidence = filteredJob ? summarizeVoiceEvidence(filteredJob) : [];
  const languages = job ? [...new Set(job.results.flatMap(r => r.assessment ? [r.assessment.language] : []))].sort() : [];
  const finished = job?.results.filter(r => !['pending', 'running'].includes(r.status)).length ?? 0;
  const failures = job?.results.filter(r => r.status === 'failed').length ?? 0;
  const audioIssues = job?.results.filter(retryableAudioIssue).length ?? 0;
  const rubricChanged = !!job && !!config && job.rubric !== config.rubric;
  const needsReview = job?.results.filter(r => r.assessment && eligibleScore(r.assessment, job.profile) === null).length ?? 0;
  const queueBlockers = evaluationBlockers({
    name: testName, profile, config, recordings: records, savedClips, scope: profile.scope, speakerMode: profile.speakerMode, consent,
    busy: !!busy, running: false,
  });
  const startBlockers = [...queueBlockers];
  if (queue?.active || queue?.waiting.length || job?.status === 'running')
    startBlockers.push('An evaluation is running or queued. Use Add to queue to schedule this test.');
  const nextUnreviewed = profile.speakerMode !== 'automatic' ? included.find(recording => !recordingReviewed(recording, profile.scope)) : undefined;
  const plannedInputs = savedClips ? savedClips.filter(c => c.include).length : inputCount(included, profile.scope, profile.speakerMode);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">v<span>≈</span></span><div>Voices Selection<small>QUALITY WORKBENCH</small></div></div>
      <p className="nav-label">WORKSPACE</p>
      <button className={`nav ${tab === 'setup' ? 'active' : ''}`} disabled={!!busy} title="Start a new test with previous settings and no recordings" onClick={beginNewEvaluation}><span>01</span> Evaluation setup</button>
      <button className={`nav ${tab === 'results' ? 'active' : ''}`} disabled={!!busy} onClick={() => { setShowTestList(true); setEditingTest(undefined); setTab('results'); }}><span>02</span> Test Reports</button>
      <div className="sidebar-history">
        <p className="nav-label">RECENT EVALUATIONS</p>
        <div className="history-list">
          {!history.length && <p className="muted small">Your evaluations will appear here.</p>}
          {history.slice(0, 8).map(h => <button key={h.id} className="history-item" disabled={!!busy} onClick={() => void action('Loading evaluation', () => openTest(h))}>
            <strong>{evaluationName(h)}</strong>
            <small>{h.stage === 'audition' ? 'Voice Selection' : 'TTS evaluation'} · {new Date(h.createdAt).toLocaleString()}</small>
            <small>{h.clips} excerpts · {h.status}</small>
          </button>)}
          {history.length > 8 && <button className="history-item" disabled={!!busy} onClick={() => { setShowTestList(true); setTab('results'); }}>View all {history.length} tests</button>}
        </div>
      </div>
      <div className="sidebar-foot"><span className={`dot ${config?.configured ? 'green' : ''}`} /> {config?.configured ? 'Azure credentials configured' : 'Azure setup required'}<small>Local-first · Audio-only assessment</small></div>
    </aside>
    <main>
      <header className="topbar"><span>WORKSPACE <b>/</b> {tab === 'setup' ? 'New evaluation' : 'Test Reports'}</span><span className="pill">MULTI-JUDGE PREVIEW</span></header>
      {notice && <div className="notice" role="alert"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
      {busy && <div className="working" role="status"><span className="spinner" /> {busy}</div>}
      {queue && <TestQueue state={queue} busy={!!busy}
        onPause={() => void action('Pausing queue', async () => { setQueue(await api<TestQueueState>('/api/queue/pause', {})); })}
        onStart={() => { setNotice(''); setConfirmAction({
          title: 'Start the waiting tests?', description: 'Their saved audio will be sent to the current Azure connection and normal evaluation charges apply.',
          label: 'Start queue', status: 'Starting queue',
          run: async () => { setQueue(await api<TestQueueState>('/api/queue/start', { consent: true })); },
        }); }}
        onCancel={id => void action('Cancelling test', async () => {
          await api(`/api/jobs/${id}/cancel`, {});
          if (job?.id === id) setJob(await api<Job>(`/api/jobs/${id}`));
          await refresh();
        })} />}
      {editingTest && <TestMetadataEditor key={editingTest.id} job={editingTest} busy={!!busy} onCancel={() => setEditingTest(undefined)}
        onSave={(name, voiceLabels) => void action('Saving test details', async () => {
          const metadata = testMetadataSchema.parse({ name, voiceLabels });
          const saved = await api<Job>(`/api/jobs/${editingTest.id}`, metadata, 'PATCH');
          if (job?.id === saved.id) setJob(saved);
          setHistory(previous => previous.map(entry => entry.id === saved.id ? testHistory(saved) : entry));
          setEditingTest(undefined); setNotice('Test name saved. List language and gender were refreshed from the name. Scores, audio and test time are unchanged.');
        })} />}
      {confirmDelete && <ConfirmationDialog title={`Delete ${evaluationName(confirmDelete)}?`} description="This permanently removes this evaluation and its results from history. Shared saved audio and the current setup draft are kept. This cannot be undone."
        busy={!!busy} onCancel={() => setConfirmDelete(undefined)}>
        {notice && <p className="error-text" role="alert">{notice}</p>}
        <div className="button-row"><button className="secondary danger" disabled={!!busy} onClick={() => void action('Deleting evaluation', () => deleteEvaluation(confirmDelete))}>Confirm deletion</button>
          <button className="secondary" data-dialog-cancel="" disabled={!!busy} onClick={() => setConfirmDelete(undefined)}>Keep evaluation</button></div>
      </ConfirmationDialog>}
      {confirmAction && <ConfirmationDialog title={confirmAction.title} description={confirmAction.description} busy={!!busy} onCancel={() => setConfirmAction(undefined)}>
        {notice && <p className="error-text" role="alert">{notice}</p>}
        <div className="button-row"><button className="secondary" disabled={!!busy} onClick={() => void action(confirmAction.status, async () => {
          await confirmAction.run(); setConfirmAction(undefined);
        })}>{confirmAction.label}</button>
          <button className="secondary" data-dialog-cancel="" disabled={!!busy} onClick={() => setConfirmAction(undefined)}>Cancel</button></div>
      </ConfirmationDialog>}
      {confirmBulk && <ConfirmationDialog title={`${confirmBulk.action === 'delete' ? 'Delete' : 'Redo'} ${confirmBulk.entries.length} selected test${confirmBulk.entries.length === 1 ? '' : 's'}?`}
        description={confirmBulk.action === 'delete'
          ? 'Permanently delete these tests and their results? This cannot be undone. Shared saved audio is kept.'
          : 'Create fresh evaluations from each test’s saved audio, guide, language and judging panel, then run them through the queue. Original results are kept. This sends audio to Azure and incurs new evaluation charges.'}
        busy={!!busy} onCancel={() => { setConfirmBulk(undefined); setBulkConsent(false); }}>
        <p className="hint">This includes selected tests on other pages or hidden by filters. Running and queued tests cannot be changed.</p>
        <ul className="test-bulk-list">{confirmBulk.entries.map(entry => <li key={entry.id}>{entry.name}</li>)}</ul>
        {confirmBulk.action === 'redo' && <label className="checkbox-label"><input type="checkbox" checked={bulkConsent} disabled={!!busy} onChange={event => setBulkConsent(event.target.checked)} /> I authorize sending these tests’ saved audio to Azure and incurring new evaluation charges.</label>}
        {notice && <p className="error-text" role="alert">{notice}</p>}
        <div className="button-row"><button className={`secondary ${confirmBulk.action === 'delete' ? 'danger' : ''}`} disabled={!!busy || (confirmBulk.action === 'redo' && !bulkConsent)}
          onClick={() => void action('Applying bulk test action', bulkAction)}>{confirmBulk.action === 'delete' ? 'Confirm deletion' : 'Confirm redo and queue'}</button>
          <button className="text-button" data-dialog-cancel="" disabled={!!busy} onClick={() => { setConfirmBulk(undefined); setBulkConsent(false); }}>Cancel</button></div>
      </ConfirmationDialog>}
      {bulkReport && <section className="test-bulk-report" aria-label="Bulk action results">
        <div><strong role="status">{bulkReport.result.succeeded.length} test{bulkReport.result.succeeded.length === 1 ? '' : 's'} {bulkReport.action === 'delete' ? 'deleted' : 'queued for fresh evaluation'} · {bulkReport.result.failed.length} failed</strong>
          <button className="text-button" onClick={() => setBulkReport(undefined)}>Dismiss results</button></div>
        {!!bulkReport.result.failed.length && <ul role="alert">{bulkReport.result.failed.map(item => <li key={item.id}><strong>{bulkReport.names.get(item.id) ?? item.id}:</strong> {item.error}</li>)}</ul>}
      </section>}
      {tab === 'setup' ? <>
        <section className="hero">
          <div><p className="eyebrow">LISTEN CLOSER. COMPARE FAIRLY.</p><h1>Find the right voice.</h1></div>
          <div className="hero-art" aria-hidden="true">{Array.from({ length: 23 }, (_, i) => <i key={i} style={{ height: `${18 + Math.sin(i * 1.7) ** 2 * 72}px` }} />)}</div>
        </section>
        <section className="card test-identity">
          {draftSource && <p className="hint">Editable copy of {draftSource}. Starting creates a new evaluation; the original results stay unchanged.</p>}
          <label><span>Test name <span className="required-mark" aria-hidden="true">*</span></span><input required maxLength={120} value={testName} disabled={!!busy} onChange={e => {
            const name = e.target.value; setTestName(name); setProfile(previous => withTestNameLanguage(previous, name));
          }} placeholder="For example: ko-KR Female VTS" /></label>
        </section>
        <div className="setup-grid">
          <section className="card"><SectionTitle step="01" title="Choose your evaluation" description="Different stages deserve different criteria." />
            <div className="stage-options">
              <button className={`stage-card ${profile.stage === 'audition' ? 'chosen' : ''}`} onClick={() => setProfile({ ...profile, stage: 'audition' })}>
                <strong>Voice Selection</strong><small>Recording quality: diagnostic only</small>
              </button>
              <button className={`stage-card ${profile.stage === 'tts' ? 'chosen' : ''}`} onClick={() => setProfile({ ...profile, stage: 'tts' })}>
                <strong>TTS evaluation</strong><small>Audio quality: included in score</small>
              </button>
            </div>
            <div className="field-row"><label>Who should be scored?<select value={profile.scope} disabled={!!busy} onChange={e => {
              const scope = e.target.value as Profile['scope']; setProfile({ ...profile, scope });
              setRecords(old => old.map(r => ({ ...r, regions: r.duration ? defaultRegions(scope, r.duration) : [] })));
            }}>
              <option value="single">Single speaker</option><option value="agent">Agent only</option><option value="customer">Customer only</option><option value="both">Both, scored separately</option>
            </select></label><label>Language / accent<input value={profile.language} maxLength={500} disabled={!!busy} onChange={e => setProfile(withLanguageAccent(profile, e.target.value))} placeholder="auto, British English, Italian for Italy..." /></label></div>
            <p className="hint" role="status">Language / accent is filled from a single locale code in the test name; you can override it. Accent fit: {profile.targetMarket?.trim() ? 'on' : 'off (auto language detection)'}</p>
            <div className="button-row"><button className="secondary" disabled={!!busy || !(savedClips?.length ?? records.length)} onClick={() => void action('Applying language hint', async () => applyLanguageToAll())}>Apply to all recordings</button></div>
            <label className="speaker-mode">Speaker selection<select value={profile.speakerMode ?? 'manual'} disabled={!!busy || savedClips !== undefined} onChange={e => setProfile({ ...profile, speakerMode: e.target.value === 'manual' ? 'manual' : 'automatic' })}>
              <option value="automatic">Automatic — infer roles from conversation content</option>
              <option value="manual">Advanced — manual speaker ranges / channels</option>
            </select></label>
            <p className="hint">{profile.speakerMode === 'automatic'
              ? 'Roles are inferred automatically; unclear roles are flagged.'
              : 'Confirm speaker ranges or channels for each recording.'}</p>
            <label><span>Target vocal style or test guide <span className="required-mark" aria-hidden="true">*</span></span><textarea required rows={2} maxLength={1500} value={profile.target} disabled={!!busy} aria-invalid={!profile.target.trim()} aria-describedby={!profile.target.trim() ? 'target-style-guidance' : undefined} onChange={e => setProfile({ ...profile, target: e.target.value })} placeholder="For example: warm, calm, conversational and effortless to listen to" /></label>
            {!profile.target.trim() && <p id="target-style-guidance" className="hint" role="status">Add a vocal style or test guide to start.</p>}
            <details className="voice-evidence"><summary>Evaluation guide · {RUBRIC_VERSION}</summary>
              <p className="hint">Judges rate audible vocal delivery, not script quality or task completion. Reports are in English. Unsupported languages, unclear roles and insufficient evidence are flagged, not guessed.</p>
              <p className="hint">Language / accent guides listening and, unless set to auto, activates an equally weighted accent-fit score. Specify acceptable regional variation. Judges assess audible fit, not identity or nationality, without double-penalizing accent differences.</p>
              <p className="hint">New recordings inherit the language hint. Per-recording overrides affect listening only. Apply to all replaces hints for all draft inputs, including excluded ones; saved results stay unchanged.</p>
              <ul>{dimensions.map(d => <li key={d}><strong>{labels[d]}:</strong> {voiceDimensionGuidance[d]}</li>)}</ul>
            </details>
          </section>
          <section className="card"><SectionTitle step="02" title="Your judging panel" description="Each deployment listens independently using the same rubric." />
            {config && <AzureConnection config={config} busy={!!busy} onAction={action} onSaved={status => setConfig(previous => previous ? { ...previous, ...status } : previous)} />}
            {config?.judges.map((judge, index) => <div className="judge" key={judge.id}>
              <span className="judge-avatar">{index + 1}</span>
              <div className="judge-fields"><label>Judge name<input value={judge.name} maxLength={80} disabled={!!busy} onChange={e => setConfig({ ...config, judges: config.judges.map(j => j.id === judge.id ? { ...j, name: e.target.value } : j) })} /></label>
                <label>Azure deployment name<input value={judge.deployment} maxLength={120} disabled={!!busy} onChange={e => setConfig({ ...config, judges: config.judges.map(j => j.id === judge.id ? { ...j, deployment: e.target.value } : j) })} /></label></div>
              <button className="icon-button" aria-label={`Remove ${judge.name}`} disabled={!!busy || config.judges.length === 1} onClick={() => setConfig({ ...config, judges: config.judges.filter(j => j.id !== judge.id) })}>×</button>
            </div>)}
            <div className="button-row"><button className="secondary" disabled={!!busy || !config} onClick={() => config && setConfig({ ...config, judges: [...config.judges, { id: crypto.randomUUID(), name: `Judge ${config.judges.length + 1}`, deployment: '' }] })}>+ Add judge</button>
              <button className="text-button" disabled={!config || !!busy} onClick={() => void action('Saving panel', async () => {
                await api('/api/settings', { judges: config?.judges }, 'PUT'); await refresh();
              })}>Save panel</button></div>
            <p className="hint">No fixed judge limit. Each added judge increases Azure usage and concurrent requests; deployment quotas still apply. Use actual deployment names, not display names. Related models can share biases; agreement is not a confidence guarantee.</p>
          </section>
        </div>
        <section className="card recordings-card" ref={recordingsSection}><div className="section-with-action"><SectionTitle step="03" title="Bring your recordings" description="Parent folder → voice subfolders → audio files. Originals stay untouched." />
          <input ref={element => { folder.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={e => { importFiles(e.target.files); e.target.value = ''; }} />
          <button className="secondary" disabled={!!busy} onClick={() => {
            if (!folder.current) { setNotice('The folder picker is unavailable. Reload the workbench and try again.'); return; }
            folder.current.value = ''; folder.current.click();
          }}>+ Select folder</button></div>
          <p className="hint">Selecting a folder replaces the current draft recordings, including reused saved audio. Canceling the picker keeps the current selection. Saved evaluations are never changed.</p>
          {savedClips !== undefined ? <>
            <p className="hint">Reusing saved audio inputs, not the original full recordings. Original ranges, channels and speaker-selection mode are preserved. You can change voices and language hints or exclude inputs. Keep the required roles for each recording; select a folder to replace these inputs and edit ranges or speaker mode.</p>
            {!savedClips.length && <p role="alert">No saved audio is available. Select the original folder to continue.</p>}
            {savedClips.map(c => <div className="card" key={c.id}>
              <label className="checkbox-label"><input type="checkbox" disabled={!!busy} checked={c.include} onChange={e => setSavedClips(old => old?.map(value => value.id === c.id ? { ...value, include: e.target.checked } : value))} />{c.file} · {c.role} · {c.start.toFixed(2)}–{c.end.toFixed(2)} s · {c.channel}</label>
              <div className="field-row"><label>Voice<input value={c.voice} maxLength={200} disabled={!!busy} onChange={e => setSavedClips(old => old?.map(value => value.id === c.id ? { ...value, voice: e.target.value } : value))} /></label>
                <label>Saved input language hint<input value={c.language} maxLength={500} disabled={!!busy} onChange={e => setSavedClips(old => old?.map(value => value.id === c.id ? { ...value, language: e.target.value } : value))} /></label></div>
              <audio controls preload="none" src={`/api/clips/${c.id}/audio`} aria-label={`Saved input ${c.file} ${c.role}`} />
            </div>)}
          </> : !records.length ? <button className="dropzone" onClick={() => folder.current?.click()}><span className="folder-icon">▱</span><strong>Select your voice collection</strong><span>WAV, MP3, M4A, OGG, FLAC, WebM · Browser codec support varies</span><small>Recordings are not sent to Azure until you start an evaluation.</small></button> :
            <><div className="collection-bar"><span><strong>{voiceCount}</strong> voices <b>·</b> <strong>{included.length}</strong> recordings {profile.speakerMode !== 'automatic' && <><b>·</b> <strong>{confirmed}</strong> reviewed</>}</span><span>{profile.speakerMode === 'automatic' ? 'Automatic role listening — no file confirmations needed' : 'Review speaker regions before running'}</span></div>
              <div className="recording-workspace"><div className="file-list">{records.map(r => <div key={r.id} className={`file-row ${r.id === selected ? 'selected' : ''}`}>
                <input aria-label={`Include ${r.path}`} type="checkbox" checked={r.include} onChange={e => updateRecording(r.id, { include: e.target.checked })} />
                <button onClick={() => setSelected(r.id)}><strong>{r.voice}</strong><span>{r.file.name}</span></button>
                <span className={`review-dot ${profile.speakerMode === 'automatic' ? 'automatic' : recordingReviewed(r, profile.scope) ? 'done' : ''}`} title={profile.speakerMode === 'automatic' ? 'Role will be inferred during evaluation' : recordingReviewed(r, profile.scope) ? 'Reviewed' : 'Needs review'} />
              </div>)}</div>
                <div className="editor">{current && <>
                  <div className="section-with-action"><div><p className="eyebrow">{current.voice}</p><h3>{current.file.name}</h3></div><span className="pill">{buffer ? `${buffer.duration.toFixed(1)}s · ${buffer.numberOfChannels}ch` : 'Loading audio...'}</span></div>
                  {sourceUrl && <audio controls src={sourceUrl} aria-label="Original recording" />}
                  {buffer && <Waveform buffer={buffer} regions={profile.speakerMode === 'automatic' ? [] : current.regions} />}
                  {profile.speakerMode === 'automatic' ? <div className="callout">The complete recording is included automatically. Judges infer the {profile.scope === 'both' ? 'agent and customer roles and score them separately' : profile.scope === 'single' ? 'single speaker' : `${profile.scope} role`} from what is said. No timestamps are required. Recordings longer than {MAX_SECONDS}s are split into consecutive windows without dropping audio. Ambiguous roles and overlapping speech can remain unscored.</div> : <>
                  <p className="hint">Select only the target speaker's speech. For a shared mono conversation, add separate non-overlapping turns. Stereo channels can isolate speakers. Each excerpt: 0.5–{MAX_SECONDS}s. Do not include overlap you cannot separate.</p>
                  {current.regions.map((region, index) => <div className="region" key={region.id}>
                    <span className="region-number">{index + 1}</span>
                    <label>Role<select value={region.role} onChange={e => updateRegion(region.id, { role: e.target.value as Region['role'] })}>
                      {profile.scope === 'single' ? <option value="speaker">Speaker</option> : <>
                        {(profile.scope === 'agent' || profile.scope === 'both') && <option value="agent">Agent</option>}
                        {(profile.scope === 'customer' || profile.scope === 'both') && <option value="customer">Customer</option>}</>}
                    </select></label>
                    <label>Start (s)<input type="number" min={0} step={0.1} value={region.start} onChange={e => updateRegion(region.id, { start: e.target.valueAsNumber })} /></label>
                    <label>End (s)<input type="number" min={0} step={0.1} value={region.end} onChange={e => updateRegion(region.id, { end: e.target.valueAsNumber })} /></label>
                    <label>Channel<select value={region.channel} onChange={e => updateRegion(region.id, { channel: e.target.value as Region['channel'] })}><option value="mix">Mix / mono</option><option value="left">Left / ch 1</option><option value="right" disabled={(current.channels ?? 0) < 2}>Right / ch 2</option></select></label>
                    <button className="icon-button" aria-label={`Preview region ${index + 1}`} disabled={!buffer || !!busy} onClick={() => void action('Preparing preview', async () => {
                      setPreviewUrl(URL.createObjectURL(browserWav(await toPcm(buffer!, region))));
                    })}>▶</button>
                    <button className="icon-button" aria-label={`Remove region ${index + 1}`} onClick={() => updateRecording(current.id, { regions: current.regions.filter(r => r.id !== region.id) })}>×</button>
                  </div>)}
                  {previewUrl && <div className="preview"><small>Selected excerpt · same 24 kHz audio sent to judges</small><audio controls autoPlay src={previewUrl} aria-label="Selected speaker excerpt" /></div>}
                  <div className="button-row"><button className="text-button" disabled={!buffer} onClick={() => updateRecording(current.id, { regions: [...current.regions, {
                    id: crypto.randomUUID(), role: profile.scope === 'single' ? 'speaker' : profile.scope === 'customer' ? 'customer' : 'agent',
                    start: 0, end: Math.min(current.duration ?? 0, MAX_SECONDS), channel: 'mix', confirmed: false,
                  }] })}>+ Add speaker turn</button>
                    <button className="secondary" disabled={!buffer || !current.regions.length || !!busy} onClick={() => void action('Confirming regions', confirmRegions)}>{recordingReviewed(current, profile.scope) ? '✓ Regions confirmed' : 'Confirm speaker regions'}</button></div>
                  </>}
                  <label className="language-override">Recording language override<input value={current.language} maxLength={500} onChange={e => updateRecording(current.id, { language: e.target.value })} placeholder="auto = use evaluation language/accent" /></label>
                </>}</div></div></>}
        </section>
        <section className="run-card"><div><h3>Ready for a closer listen?</h3><p>{profile.speakerMode === 'automatic' && included.some(r => r.duration === undefined) ? 'At least ' : ''}{plannedInputs} role/audio inputs × {config?.judges.length ?? 0} judges. {profile.scope === 'both' && 'Both roles use separate assessments of the same conversation. '}Azure usage is billed per your deployment; no cost estimate is available.</p>
          <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I have permission to send these audio inputs to my configured Azure resource.</label>
          <small>Automatic mode sends conversation windows; manual mode sends selected excerpts. Missing-audio claims, zero audio-token responses or exhausted format retries may trigger one fresh-session re-upload. Each session allows one format retry, within a total 180-second deadline. Retries incur additional Azure usage and never force scores. Audio inputs, names, ratings and results persist unencrypted on this computer. No transcript is requested or stored.</small>
          <div id="evaluation-readiness" className={`evaluation-readiness ${queueBlockers.length ? '' : 'ready'}`} role="status" aria-live="polite">
            {queueBlockers.length ? <><strong>Before you can start or queue</strong><ul>{queueBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></> : <strong>Ready to start or add to queue.</strong>}
          </div>
          {nextUnreviewed && <button className="secondary" disabled={!!busy} onClick={() => {
            setSelected(nextUnreviewed.id);
            recordingsSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>Review next recording: {nextUnreviewed.file.name}</button>}</div>
          <div className="run-actions"><button className="primary" disabled={queueBlockers.length > 0} aria-describedby="evaluation-readiness" onClick={() => void action('Preparing queued test', () => start(true))}>Add to queue</button>
            <button className="secondary" disabled={startBlockers.length > 0} title={startBlockers.length ? startBlockers.join(' ') : 'Start the evaluation'} aria-describedby="evaluation-readiness" onClick={() => void action('Preparing evaluation', () => start())}>Start evaluation <span>→</span></button></div></section>
        <p className="disclaimer">AI opinion scores are not validated MOS. This version does not include a dedicated MOS predictor, automatic diarization or a human listening panel.</p>
      </> : <>
        <div hidden={!showTestList}><TestLibrary entries={history} busy={!!busy} selectedIds={selectedTestIds} onSelectionChange={setSelectedTestIds}
          onBulkAction={(operation, entries) => { setConfirmBulk({ action: operation, entries }); setBulkConsent(false); setBulkReport(undefined); setNotice(''); }}
          onOpen={entry => void action('Loading evaluation', () => openTest(entry))}
          onEdit={entry => void action('Loading test details', async () => { setEditingTest(await api<Job>(`/api/jobs/${entry.id}`)); })}
          onDelete={entry => { setConfirmDelete(entry); setNotice(''); }}
          onDownload={(entry, kind) => void action('Preparing report download', () => downloadReports(entry, kind))}
          onRegenerate={entry => void action('Regenerating saved reports', () => openTest(entry, true))}
          onRefresh={() => void action('Refreshing tests', refresh)} /></div>
        <div hidden={showTestList}>
        <button className="text-button" disabled={!!busy} onClick={() => setShowTestList(true)}>Back to all tests</button>
        <div className="page-title"><div><p className="eyebrow">EVIDENCE, NOT JUST A LEADERBOARD</p><h1>{job ? evaluationName(job) : 'Voice comparison'}</h1><p className="muted">Voice comparison · Different content and languages can affect results.</p>{job && <p className="hint">{new Date(job.createdAt).toLocaleString()} · ID: {job.id}</p>}</div>
          <div className="button-row">{job && <><button className="secondary" onClick={() => exportCsv(job)}>Export CSV</button><button className="secondary" onClick={() => exportVoiceEvidenceCsv(job)}>Export voice summaries</button><button className="secondary" onClick={() => exportReportJson(job)}>Export JSON</button></>}</div></div>
        {!job ? <section className="card empty"><h2>No evaluation selected</h2><p>Start an evaluation or open a previous run from the sidebar.</p><button className="primary" onClick={beginNewEvaluation}>Set up evaluation</button></section> : <>
          <div className="status-strip"><span className={`status-badge ${job.status}`}>{job.status}</span><strong>{job.profile.stage === 'audition' ? 'Voice Selection' : 'TTS evaluation'}</strong><span>{job.profile.scope} · {job.profile.speakerMode === 'automatic' ? 'Automatic roles' : 'Manual ranges'} · {job.judges.length} judges · {job.rubric}</span>
            <button className="secondary" title="Copy settings and available saved audio into a new editable evaluation" disabled={!!busy || !config} onClick={() => requestReuseEvaluation(job)}>Edit inputs</button>
            <button className="secondary" disabled={!!busy || ['running', 'queued'].includes(job.status)} onClick={() => setEditingTest(job)}>Edit test details</button>
            <button className="text-button danger" disabled={!!busy || ['running', 'queued'].includes(job.status)} onClick={() => { setConfirmDelete(testHistory(job)); setNotice(''); }}>Delete</button>
            <button className="text-button" disabled={!!busy} onClick={() => void action('Refreshing results', async () => { setJob(await api<Job>(`/api/jobs/${job.id}`)); await refresh(); })}>Refresh results</button>
            {['running', 'queued'].includes(job.status) ? <button className="text-button danger" disabled={!!busy} onClick={() => void action('Cancelling evaluation', async () => { await api(`/api/jobs/${job.id}/cancel`, {}); setJob(await api<Job>(`/api/jobs/${job.id}`)); await refresh(); })}>Cancel</button> :
              job.results.some(r => r.status !== 'completed') && <button className="secondary" disabled={!consent || !!busy || !config || rubricChanged} title={rubricChanged ? 'The rubric changed. Use Edit inputs to create a new evaluation.' : 'Requires Azure audio permission from setup'} onClick={() => void action('Resuming evaluation', async () => {
                setJob(await api<Job>(`/api/jobs/${job.id}/resume`, { consent })); await refresh();
              })}>Retry incomplete judges</button>}
            {!['running', 'queued'].includes(job.status) && audioIssues > 0 && <button className="secondary" disabled={!consent || !!busy || !config || rubricChanged} title={rubricChanged ? 'The rubric changed. Use Edit inputs to create a new evaluation.' : 'Retry only missing-audio claims'} onClick={() => void action('Retrying suspected audio-input issues', async () => {
              setJob(await api<Job>(`/api/jobs/${job.id}/resume`, { consent, retryAudioIssues: true })); await refresh();
            })}>Retry audio-input issues ({audioIssues})</button>}</div>
          {!['running', 'queued'].includes(job.status) && !rubricChanged && (audioIssues > 0 || job.results.some(r => r.status !== 'completed')) && <label className="checkbox-label resume-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I authorize resending the selected retry inputs to Azure, including bounded automatic recovery. Retried assessments incur new usage. Previous results are retained in the audit history.</label>}
          {audioIssues > 0 && !rubricChanged && <div className="callout">{audioIssues} assessments claim missing audio. This is distinct from genuine silence, unsupported language or uncertain roles. Use Retry audio-input issues to recheck only these completed verdicts; other completed assessments are preserved.</div>}
          {job.rubric === RUBRIC_VERSION
            ? <div className="callout"><strong>Voice-persona rubric:</strong> scores concern audible tone, emotion, vocal character and pleasant, effortless listening, not script logic or service-task quality. Meaning is used only for speaker-role attribution.</div>
            : <div className="callout"><strong>Earlier rubric · {job.rubric}:</strong> these saved scores and comments have not been re-evaluated under the {RUBRIC_VERSION} voice-persona criteria. Use Edit inputs to reuse the saved audio in a new evaluation. Retrying across rubric versions is blocked to avoid mixing judgments.</div>}
          <p className="hint">Evaluation language hint: {job.profile.language}. Per-input hints are shown with each recording. Target market/accent: {job.profile.targetMarket || 'Not supplied; accent fit is not scored.'}</p>
          <div className="progress-track"><div style={{ width: `${finished / job.results.length * 100}%` }} /></div>
          <div className="metrics"><Metric label="Judge assessments finished" value={`${finished} / ${job.results.length}`} /><Metric label="Failures" value={String(failures)} /><Metric label="Unassessable / partial" value={String(needsReview)} /><Metric label="Recording quality" value={job.profile.stage === 'audition' ? 'Diagnostic only' : 'Included'} /></div>
          <div className="callout">Scores are uncalibrated AI opinions on a 1–5 scale, not MOS. Consensus requires every configured judge. In automatic mode, windows unanimously marked role not present are excluded and counted; ambiguous roles, disagreements and failures prevent the recording from entering the preference average. The overall preference score equally weights active dimensions; it is not a probability or proof of voice superiority.</div>
          <section className="card"><div className="section-with-action"><div><h2>Recording-set comparison</h2><p className="hint">Duration-weighted regions → one recording score → equal-weight recording average. Agent and customer stay separate.</p></div>
            <label>Language<select value={languageFilter} onChange={e => setLanguageFilter(e.target.value)}><option value="all">All languages (not controlled)</option>{languages.map(l => <option key={l} value={l}>{l}</option>)}</select></label></div>
            <div className="table-scroll"><table><thead><tr><th>Voice / role</th><th>Eligible files</th><th>Preference</th>{activeDimensions(job.profile).map(d => <th key={d}>{labels[d]}</th>)}<th>Judge spread</th></tr></thead><tbody>
              {summary.map(s => <SummaryRow key={JSON.stringify([s.voice, s.role])} summary={s} dimensions={activeDimensions(job.profile)} />)}
              {!summary.length && <tr><td colSpan={10}>No recordings match this filter yet. Language filtering requires agreement across the full judge panel.</td></tr>}
            </tbody></table></div>
            <p className="hint">Judge spread = mean per-region max–min preference score. It is disagreement, not a confidence interval. Recording score ranges and language labels appear below; language mixes and unequal recording sets can bias comparisons.</p>
            <div className="summary-notes">{summary.map(s => <span key={JSON.stringify([s.voice, s.role])}><strong>{s.voice} / {s.role}</strong> · recording range {score(s.min)}–{score(s.max)} · {s.languages.join(', ') || 'language pending'}{s.absentWindows > 0 && ` · ${s.absentWindows} role-absent windows excluded`}</span>)}</div>
          </section>
          <VoiceJudgeMatrix job={job} voices={voiceEvidence} />
          <VoiceImprovement job={job} voices={filteredJob ? voiceDirectorBriefs(filteredJob) : []} />
          <section className="card voice-evidence"><h2>Voice issues &amp; judge evidence</h2>
            <p className="hint">Compiled locally from saved judge comments, not a new model opinion. Observations can include strengths as well as concerns. Identical comments are grouped by distinct recording, not window count; paraphrases are not merged. Judges and roles remain separate. This view follows the language filter; exports include the full evaluation.</p>
            {voiceEvidence.map(voice => <details key={JSON.stringify([voice.voice, voice.role])}>
              <summary><strong>{voice.voice} / {voice.role}</strong> · {voice.eligibleFiles}/{voice.files} files in the full-panel average</summary>
              {voice.judges.map(evidence => {
                const judge = job.judges.find(j => j.id === evidence.judgeId)!;
                return <article key={evidence.judgeId}><h3>{judge.name}</h3><p className="hint">{judge.deployment} · {evidence.scoredFiles}/{voice.files} files scored by this judge. A full-panel recording still requires every judge.</p>
                  <h4>Scoring gaps and role / language limitations</h4>
                  {evidence.gaps.length ? <EvidenceList notes={evidence.gaps} /> : <p>No scoring gaps reported.</p>}
                  <details><summary>Reported observations ({evidence.observations.length} distinct comments)</summary>{evidence.observations.length ? <EvidenceList notes={evidence.observations} /> : <p>No observations recorded.</p>}</details>
                  <details><summary>Reported limitations ({evidence.limitations.length} distinct comments)</summary>{evidence.limitations.length ? <EvidenceList notes={evidence.limitations} /> : <p>No limitations recorded.</p>}</details>
                  <details><summary>Dimension evidence</summary>{evidence.dimensions.map(d => <div key={d.dimension}><h4>{labels[d.dimension]} · {score(d.score)}{d.diagnostic ? ' (diagnostic only)' : ''}</h4>{d.reasons.length ? <EvidenceList notes={d.reasons} /> : <p>No scored evidence available.</p>}</div>)}</details>
                </article>;
              })}
            </details>)}
          </section>
          <section className="card"><h2>Listen, inspect, decide</h2><p className="hint">Saved audio is the exact resampled input evaluated. {job.profile.speakerMode === 'automatic' ? 'Automatic inputs contain the conversation, not isolated target-speaker audio. Technical diagnostics describe the whole input window, not an individual role. ' : 'Quality diagnostics describe the selected input, not the original master file. '}Quiet-sample percentage is not a speech detector.</p>
            {(filteredJob?.clips ?? []).map(c => <details className="clip-detail" key={c.id}><summary><span><strong>{c.voice}</strong> / {c.role}<small>{c.file} · {c.start.toFixed(1)}–{c.end.toFixed(1)}s · {c.channel} · language hint: {c.language}</small></span><span className="pill">{job.results.filter(r => r.clipId === c.id && r.status === 'completed').length}/{job.judges.length} judges</span></summary>
              <audio controls preload="none" src={`/api/clips/${c.id}/audio`} aria-label={job.profile.speakerMode === 'automatic' ? `${c.voice} conversation window for ${c.role} assessment` : `${c.voice} ${c.role} excerpt`} />
              <div className="technical"><span>Peak: {c.technical.peakDb?.toFixed(1) ?? '−∞'} dBFS</span><span>RMS: {c.technical.rmsDb?.toFixed(1) ?? '−∞'} dBFS</span><span>Near-full-scale samples: {c.technical.clippingPercent.toFixed(2)}%</span><span>Quiet samples: {c.technical.quietPercent.toFixed(1)}%</span></div>
              <div className="judge-results">{job.results.filter(r => r.clipId === c.id).map(r => {
                const judge = job.judges.find(j => j.id === r.judgeId)!;
                return <article key={r.judgeId}><h3>{judge.name}<span className="status-badge">{r.status}</span></h3><small>{judge.deployment}{r.model ? ` · reported: ${r.model}` : ''}</small>
                  {r.responseFormat && <p className="hint">{r.responseFormat === 'function_call' ? 'Output: validated assessment function.' : r.responseFormat === 'function_call_with_preamble' ? 'Output: validated assessment function with an allowed acknowledgement or intent preamble ignored. All scores and evidence come from the function arguments, not the preamble.' : r.responseFormat === 'json_text' ? 'Output: validated JSON text. The deployment returned text instead of the requested function call.' : 'Output: validated JSON text with surrounding formatting removed. No scores or fields were repaired.'}</p>}
                  {r.error && <p className="error-text">{r.error}</p>}
                  {r.audioDiagnostics ? <details><summary>Audio-delivery diagnostics · {r.audioDiagnostics.recovery.replaceAll('_', ' ')}</summary>
                    <p className="hint">Input: {r.audioDiagnostics.inputBytes} bytes · SHA-256: {r.audioDiagnostics.inputSha256}. Matching hashes verify identical PCM input, not identical model judgments. Audio tokens confirm service accounting, not perceptual accuracy.</p>
                    {r.audioDiagnostics.sessions.map((session, index) => <div key={index}><h4>Session {index + 1} · {session.model ?? 'Model not reported'}</h4>
                      <p className="hint">{session.uploadedBytes} bytes uploaded · {session.committed ? 'Azure confirmed audio commit' : 'Audio commit not confirmed'}</p>
                      {session.error && <p className="error-text">{session.error}</p>}
                      <ul>{session.responses.map((response, i) => <li key={i}>Response {i + 1}: {response.outcome.replaceAll('_', ' ')} · Input audio tokens: {response.inputAudioTokens ?? 'not reported'} · Input text tokens: {response.inputTextTokens ?? 'not reported'} · Output tokens: {response.outputTokens ?? 'not reported'} · Output types: {response.outputTypes.join(', ')}</li>)}</ul>
                    </div>)}
                  </details> : retryableAudioIssue(r) && <p className="hint">This saved verdict has no audio-delivery telemetry. A targeted retry will collect it.</p>}
                  {!!r.previousEvaluations?.length && <details><summary>Previous evaluation audit history ({r.previousEvaluations.length})</summary>
                    {r.previousEvaluations.map((previous, i) => <div key={i}><h4>Retried {new Date(previous.retriedAt).toLocaleString()} · {previous.status}</h4>
                      {previous.error && <p className="error-text">{previous.error}</p>}
                      {previous.assessment && <p>{previous.assessment.language} · {previous.assessment.assessable ? 'Assessable' : 'Unassessable'} · {previous.assessment.limitations.join(' ')}</p>}
                      <p className="hint">Complete previous scores, reasons and diagnostics are preserved in JSON and assessment CSV exports.</p>
                    </div>)}
                  </details>}
                  {r.status === 'completed' && assessmentGaps(r, job.profile, c.role).length > 0 && <div className="callout"><strong>Why this assessment cannot supply a preference score</strong><ul>{assessmentGaps(r, job.profile, c.role).map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
                  {r.assessment && <>{r.assessment.speakerAttribution && <div className="callout"><strong>Role: {r.assessment.speakerAttribution.role} · {r.assessment.speakerAttribution.status}</strong><p>{r.assessment.speakerAttribution.evidence}</p></div>}<p className="hint">{r.assessment.language} · {r.assessment.languageSupported ? 'Model reports language assessable (not independently validated)' : 'Language not reliably supported'} · preference: {score(eligibleScore(r.assessment, job.profile))}</p>
                    <dl>{dimensions.map(d => <div key={d}><dt>{labels[d]} {d === 'audioQuality' && job.profile.stage === 'audition' && <small>(diagnostic)</small>}<b>{score(r.assessment!.scores[d])}</b></dt><dd>{r.assessment!.reasons[d] ?? (d === 'accentFit' ? 'Not assessed in this saved evaluation.' : '')}</dd></div>)}</dl>
                    {!!r.assessment.observations.length && <><h4>Observations</h4><ul>{r.assessment.observations.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
                    {!!r.assessment.limitations.length && <><h4>Limitations</h4><ul className="limitations">{r.assessment.limitations.map((o, i) => <li key={i}>{o}</li>)}</ul></>}</>}
                </article>;
              })}</div></details>)}
          </section>
        </>}
        </div>
      </>}
      <footer>Voices Selection · Audio-only evaluation · Your judgement remains the final one.</footer>
    </main>
  </div>;
}
function SectionTitle({ step, title, description }: { step: string; title: string; description: string }) {
  return <div className="section-title"><span>{step}</span><h2>{title}</h2><p>{description}</p></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}
function SummaryRow({ summary: s, dimensions: ds }: { summary: Summary; dimensions: Dimension[] }) {
  return <tr><td><strong>{s.voice}</strong><small>{s.role}</small></td><td>{s.eligibleFiles} / {s.files}</td><td><span className="score">{score(s.score)}</span></td>{ds.map(d => <td key={d}>{score(s.dimensions[d])}</td>)}<td>{score(s.disagreement)}</td></tr>;
}
