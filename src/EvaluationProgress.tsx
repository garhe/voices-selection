import { useState } from 'react';
import { activeDimensions, unassessedInputs, type Job } from '../shared/domain';

type AssessmentIssue = ReturnType<typeof unassessedInputs>[number];

export function AssessmentIssueTable({ issues }: { issues: AssessmentIssue[] }) {
  return <div className="table-scroll"><table>
    <thead><tr><th>Voice</th><th>Audio / requested role</th><th>Judge</th><th>Status</th><th>Reasons</th></tr></thead>
    <tbody>{issues.flatMap(({ clip, judges }) => judges.map(({ judge, result, gaps }) =>
      <tr key={`${clip.id}:${judge.id}`}>
        <td>{clip.voice}</td>
        <td>{clip.file}<small>{clip.role} · {clip.start.toFixed(2)}–{clip.end.toFixed(2)} s</small></td>
        <td>{judge.name}<small>{judge.deployment}</small></td>
        <td>{result?.status ?? 'Missing'}</td>
        <td><ul>{[...new Set([...gaps, ...(result?.assessment?.limitations ?? [])])].map(reason =>
          <li key={reason}>{reason}</li>)}</ul></td>
      </tr>))}</tbody>
  </table></div>;
}

export function EvaluationProgress({ job, recordingQualityLabel }: { job: Job; recordingQualityLabel: string }) {
  const [expanded, setExpanded] = useState<'failures' | 'unassessed'>();
  const finished = job.results.filter(result => !['pending', 'running'].includes(result.status)).length;
  const issues = unassessedInputs(job);
  const failures = issues.map(input => ({
    ...input, judges: input.judges.filter(({ result }) => result?.status === 'failed'),
  })).filter(input => input.judges.length > 0);
  const count = (inputs: AssessmentIssue[]) => inputs.reduce((total, input) => total + input.judges.length, 0);
  const running = job.clips.flatMap(clip => job.judges.flatMap(judge =>
    job.results.some(result => result.clipId === clip.id && result.judgeId === judge.id && result.status === 'running')
      ? [{ clip, judge }] : []));
  const panelId = `assessment-issues-${job.id}`;
  return <>
    <div className="progress-track" role="progressbar" aria-label="Judge assessments finished"
      aria-valuemin={0} aria-valuemax={job.results.length || 1} aria-valuenow={finished}
      aria-valuetext={`${finished} of ${job.results.length} judge assessments finished`}>
      <div style={{ width: `${job.results.length ? finished / job.results.length * 100 : 0}%` }} />
    </div>
    <section className="assessment-activity" aria-label="Currently scoring">
      {running.length ? <><h2>Currently scoring</h2><ul>{running.map(({ clip, judge }) =>
        <li key={`${clip.id}:${judge.id}`}><strong>{clip.voice}</strong> · {clip.file}
          <small>{clip.role} · {clip.start.toFixed(2)}–{clip.end.toFixed(2)} s · {judge.name} · {judge.deployment}</small>
        </li>)}</ul></>
        : <p>{job.status === 'queued' ? 'Queued — no audio is being scored yet.'
          : job.status === 'running' ? 'Preparing the next judge assessment…' : 'No judge assessments are currently running.'}</p>}
    </section>
    <div className="metrics">
      <div className="metric"><span>Judge assessments finished</span><strong>{finished} / {job.results.length}</strong></div>
      <button type="button" className="metric metric-action" aria-expanded={expanded === 'failures'} aria-controls={panelId}
        onClick={() => setExpanded(expanded === 'failures' ? undefined : 'failures')}>
        <span>Failures</span><strong>{count(failures)}</strong>
      </button>
      <button type="button" className="metric metric-action" aria-expanded={expanded === 'unassessed'} aria-controls={panelId}
        onClick={() => setExpanded(expanded === 'unassessed' ? undefined : 'unassessed')}>
        <span>Unassessable / partial</span><strong>{count(issues)}</strong>
      </button>
      <div className="metric"><span>{recordingQualityLabel}</span><strong>{activeDimensions(job.profile).includes('audioQuality') ? 'Included' : 'Diagnostic only'}</strong></div>
    </div>
    <section id={panelId} className="card assessment-issues" aria-label="Assessment issue details" hidden={!expanded}>
      {expanded && <><div className="section-with-action">
        <h2>{expanded === 'failures' ? 'Failed assessments' : 'Unassessable / partial assessments'}</h2>
        <button type="button" className="secondary" onClick={() => setExpanded(undefined)}>Close details</button>
      </div>
        {expanded === 'unassessed' && <p className="hint">Includes missing, pending and running assessments, as well as failed or incomplete judgments. Details update as scoring progresses.</p>}
        {count(expanded === 'failures' ? failures : issues)
          ? <AssessmentIssueTable issues={expanded === 'failures' ? failures : issues} />
          : <p>{expanded === 'failures' ? 'No failed assessments.' : 'All required assessments are complete.'}</p>}
      </>}
    </section>
  </>;
}
