import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssessmentIssueTable, EvaluationProgress } from '../src/EvaluationProgress.js';
import { unassessedInputs } from '../shared/domain.js';
import { clip, job } from './fixtures.js';

test('progress identifies every currently scoring voice, audio window and judge, without listing pending work as running', () => {
  const value = job([
    clip({ voice: 'Running voice', file: 'running.wav', start: 5, end: 15 }),
    clip({ voice: 'Waiting voice', file: 'waiting.wav' }),
  ]);
  value.status = 'running';
  value.results[0].status = 'running';
  value.results[1].status = 'running';
  value.results[2].status = 'pending';
  const html = renderToStaticMarkup(createElement(EvaluationProgress, { job: value, recordingQualityLabel: 'Recording quality' }));
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="1"/);
  assert.match(html, /aria-valuemax="4"/);
  assert.match(html, /Running voice/);
  assert.match(html, /running.wav/);
  assert.match(html, /5.00–15.00 s/);
  for (const judge of value.judges) {
    assert.match(html, new RegExp(judge.name));
    assert.match(html, new RegExp(judge.deployment));
  }
  assert.doesNotMatch(html, /Waiting voice|waiting.wav/);
  assert.match(html, /aria-expanded="false" aria-controls="assessment-issues-/);
  assert.match(html, /aria-label="Assessment issue details" hidden/);
});

test('issue rows identify audio, voice, judge and specific failure, role, language and missing-rating reasons', () => {
  const value = job([
    clip({ voice: 'Voice A', file: 'folder/a.wav', role: 'agent', start: 10, end: 20 }),
    clip({ voice: 'Voice B', file: 'folder/b.wav' }),
  ]);
  value.profile = { ...value.profile, speakerMode: 'automatic' };
  for (const result of value.results) result.assessment!.speakerAttribution = {
    role: value.clips.find(clip => clip.id === result.clipId)!.role, status: 'identified', evidence: 'The requested speaker is clear.',
  };
  value.results[0].status = 'failed'; value.results[0].error = 'Service quota exceeded.';
  delete value.results[0].assessment;
  const unsupported = value.results[1].assessment!;
  unsupported.languageSupported = false;
  unsupported.speakerAttribution = { role: 'agent', status: 'uncertain', evidence: 'Two speakers overlap.' };
  unsupported.limitations = ['The agent could not be separated from background speech.'];
  value.results[2].assessment!.scores.pace = null;
  value.results[2].assessment!.reasons.pace = 'Not enough continuous speech.';
  const issues = unassessedInputs(value);
  const html = renderToStaticMarkup(createElement(AssessmentIssueTable, { issues }));
  assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length, 3);
  for (const text of ['Voice A', 'Voice B', 'folder/a.wav', 'folder/b.wav', 'Judge 1', 'Judge 2',
    'deployment-0', 'deployment-1', '10.00–20.00 s', 'Service quota exceeded.', 'Two speakers overlap.',
    'The agent could not be separated from background speech.', 'Not enough continuous speech.']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /could not reliably assess the audio language/);
  const failures = issues.map(input => ({
    ...input, judges: input.judges.filter(({ result }) => result?.status === 'failed'),
  })).filter(input => input.judges.length);
  const failureHtml = renderToStaticMarkup(createElement(AssessmentIssueTable, { issues: failures }));
  assert.match(failureHtml, /Service quota exceeded/);
  assert.doesNotMatch(failureHtml, /Judge 2|folder\/b.wav|Two speakers overlap/);
});

test('missing and pending assessments have explicit statuses and reasons', () => {
  const value = job();
  value.results.pop();
  value.results[0].status = 'pending';
  const html = renderToStaticMarkup(createElement(AssessmentIssueTable, { issues: unassessedInputs(value) }));
  assert.match(html, /Assessment is missing/);
  assert.match(html, /Assessment pending/);
  assert.match(html, /<td>Missing<\/td>/);
  assert.match(html, /<td>pending<\/td>/);
});

test('idle, queued and empty progress do not claim that a judge is scoring or produce invalid percentages', () => {
  const value = job();
  const render = () => renderToStaticMarkup(createElement(EvaluationProgress, { job: value, recordingQualityLabel: 'Recording quality' }));
  assert.match(render(), /No judge assessments are currently running/);
  value.status = 'queued';
  assert.match(render(), /Queued — no audio is being scored yet/);
  value.results = [];
  assert.match(render(), /width:0%/);
  assert.doesNotMatch(render(), /NaN|Infinity/);
});
