import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { anchoredRubricContent } from '../shared/anchoredRubric.js';
import { eligibleScore, profileRubric, summarize, type Job, type Rubric, type StoredClip, type TestQueueState } from '../shared/domain.js';

const EPSILON = 1e-9;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clipKey = (clip: StoredClip) => JSON.stringify([clip.voice, clip.file, clip.role, clip.start, clip.end, clip.channel, clip.language]);
const voiceKey = (voice: { voice: string; role: string }) => JSON.stringify([voice.voice, voice.role]);
const sign = (value: number) => Math.abs(value) < EPSILON ? 0 : Math.sign(value);

export function rankAgreement(first: number[], second: number[]) {
  if (first.length !== second.length || first.length < 2 || [...first, ...second].some(value => !Number.isFinite(value)))
    throw new Error('Rank comparison needs matching finite score vectors with at least two voices.');
  let concordant = 0, discordant = 0, tiedFirstOnly = 0, tiedSecondOnly = 0, tiedBoth = 0;
  for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++) {
    const a = sign(first[i] - first[j]), b = sign(second[i] - second[j]);
    if (!a && !b) tiedBoth++;
    else if (!a) tiedFirstOnly++;
    else if (!b) tiedSecondOnly++;
    else if (a === b) concordant++;
    else discordant++;
  }
  const denominator = Math.sqrt((concordant + discordant + tiedFirstOnly) * (concordant + discordant + tiedSecondOnly));
  return {
    kendallTauB: denominator ? (concordant - discordant) / denominator : null,
    concordant, discordant, tiedFirstOnly, tiedSecondOnly, tiedBoth,
    strictPairAgreement: concordant + discordant ? concordant / (concordant + discordant) : null,
  };
}

function stats(values: number[]) {
  const average = mean(values);
  return {
    mean: average, min: Math.min(...values), max: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
    sampleStdDev: values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)) : null,
  };
}

export function compareRuns(jobs: Job[]) {
  if (jobs.length < 2) throw new Error('At least two completed runs are required.');
  const first = jobs[0];
  const firstClips = new Map(first.clips.map(clip => [clipKey(clip), clip]));
  if (firstClips.size !== first.clips.length) throw new Error('Duplicate audio identities prevent a matched comparison.');
  const summaries = jobs.map(job => {
    if (job.status !== 'completed' || job.results.length !== job.clips.length * job.judges.length ||
        job.results.some(result => result.status !== 'completed' || !result.assessment))
      throw new Error(`Run ${job.id} has incomplete or failed assessments; no consistency claim can be made.`);
    if (!isDeepStrictEqual(job.profile, first.profile) || !isDeepStrictEqual(job.judges, first.judges) || job.rubric !== first.rubric)
      throw new Error(`Run ${job.id} settings do not match the comparison cohort.`);
    if (job.clips.length !== first.clips.length || new Set(job.clips.map(clipKey)).size !== firstClips.size ||
        job.clips.some(clip => !firstClips.has(clipKey(clip))))
      throw new Error(`Run ${job.id} audio selection differs.`);
    const summary = summarize(job);
    if (summary.some(voice => voice.score === null || voice.eligibleFiles !== voice.files))
      throw new Error(`Run ${job.id} has excluded recordings; scores are not fully matched.`);
    return new Map(summary.map(voice => [voiceKey(voice), voice]));
  });
  const keys = [...summaries[0].keys()].sort();
  const vectors = summaries.map(summary => keys.map(key => summary.get(key)!.score!));
  const assessmentVectors = jobs.map(job => [...firstClips.keys()].flatMap(key => first.judges.map(judge => {
    const clip = job.clips.find(clip => clipKey(clip) === key)!;
    const matches = job.results.filter(result => result.clipId === clip.id && result.judgeId === judge.id);
    if (matches.length !== 1) throw new Error(`Run ${job.id} has duplicate or missing judge results.`);
    const result = matches[0];
    const original = first.results.find(result => result.clipId === firstClips.get(key)!.id && result.judgeId === judge.id)!;
    if (!result.audioDiagnostics?.inputSha256 || result.audioDiagnostics.inputSha256 !== original.audioDiagnostics?.inputSha256)
      throw new Error(`Run ${job.id} has missing or mismatched input hashes.`);
    if (result.model !== original.model) throw new Error(`Run ${job.id} has a changed recorded model name.`);
    const score = eligibleScore(result.assessment!, job.profile);
    if (score === null) throw new Error(`Run ${job.id} has an ineligible assessment.`);
    return score;
  })));
  const pairs = [];
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) {
    const differences = vectors[i].map((value, index) => value - vectors[j][index]);
    pairs.push({
      first: jobs[i].id, second: jobs[j].id, ...rankAgreement(vectors[i], vectors[j]),
      voiceScoreMAE: mean(differences.map(Math.abs)),
      assessmentScoreMAE: mean(assessmentVectors[i].map((value, index) => Math.abs(value - assessmentVectors[j][index]))),
      maxVoiceScoreChange: Math.max(...differences.map(Math.abs)),
    });
  }
  return {
    runIds: jobs.map(job => job.id), runs: jobs.length, clipsPerRun: first.clips.length,
    assessmentsPerRun: first.results.length, audioHashesMatch: true,
    voices: keys.map((key, index) => {
      const voice = summaries[0].get(key)!;
      const scores = vectors.map(vector => vector[index]);
      const ranks = vectors.map(vector => 1 + vector.filter(value => sign(value - vector[index]) > 0).length);
      return { voice: voice.voice, role: voice.role, scores, ...stats(scores), ranks, bestRank: Math.min(...ranks), worstRank: Math.max(...ranks) };
    }),
    pairs,
    meanPairwiseVoiceScoreMAE: mean(pairs.map(pair => pair.voiceScoreMAE)),
    meanPairwiseAssessmentScoreMAE: mean(pairs.map(pair => pair.assessmentScoreMAE)),
    betweenVoiceScoreRanges: vectors.map(vector => Math.max(...vector) - Math.min(...vector)),
    recoverySessions: jobs.map(job => ({
      id: job.id,
      recoveredAssessments: job.results.filter(result => result.audioDiagnostics?.recovery === 'recovered').length,
      sessions: job.results.reduce((total, result) => total + (result.audioDiagnostics?.sessions.length ?? 0), 0),
    })),
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, baseline: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' }, consent: { type: 'boolean', default: false },
    output: { type: 'string' }, base: { type: 'string', default: 'http://127.0.0.1:4310' },
  } });
  if (!values.consent || !values.source || !values.output || !values.baseline?.length)
    throw new Error('Use --consent --source <job-id> --baseline <job-id> [--baseline <job-id>] --runs 2|3 --output <new-json-path>. This sends saved audio to Azure and incurs usage.');
  const repeats = Number(values.runs);
  if (![2, 3].includes(repeats)) throw new Error('Use two or three experimental runs.');
  const base = new URL(values.base);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
      base.username || base.password || base.pathname !== '/' || base.search || base.hash)
    throw new Error('The experiment must use the local app HTTP origin.');
  const reportPath = resolve(values.output);
  async function api<T>(route: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(route, base), {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
    return await response.json() as T;
  }
  const queue = await api<TestQueueState>('/api/queue');
  if (queue.paused || queue.active || queue.waiting.length) throw new Error('Wait for an idle, unpaused queue before starting the experiment.');
  const source = await api<Job>(`/api/jobs/${values.source}`);
  const baselineIds = [...new Set([...values.baseline, source.id])];
  const baseline = await Promise.all(baselineIds.map(id => api<Job>(`/api/jobs/${id}`)));
  const baselineReport = compareRuns(baseline);
  const draft = await api<{ clips: StoredClip[]; missing: number }>(`/api/jobs/${source.id}/draft`);
  if (draft.missing || draft.clips.length !== source.clips.length) throw new Error('Some source audio is unavailable.');
  const content = anchoredRubricContent(profileRubric(source.profile));
  const report: {
    startedAt: string; source: string; baseline: ReturnType<typeof compareRuns>;
    preset?: Rubric; expectedAssessments: number; experimentIds: string[];
    status: string; completedAt?: string; experimental?: ReturnType<typeof compareRuns>;
    limitations: string[];
  } = {
    startedAt: new Date().toISOString(), source: source.id, baseline: baselineReport,
    expectedAssessments: repeats * source.clips.length * source.judges.length, experimentIds: [], status: 'starting',
    limitations: [
      'Only one collection and two baseline runs versus two or three experimental runs; no human validation or reliable significance claim.',
      'Historical request prompts and pinned underlying service versions are not stored. A backend restart or changed deployment implementation can confound the historical comparison.',
      'Recorded model names and input hashes are checked, but they do not prove identical service implementations.',
    ],
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  const save = () => writeFile(reportPath, JSON.stringify(report, null, 2));
  const presets = await api<Rubric[]>('/api/rubrics');
  let preset = presets.find(preset => preset.name === content.name);
  if (preset) {
    const { id: _id, revision: _revision, ...existing } = preset;
    if (!isDeepStrictEqual(existing, content)) throw new Error('The experimental preset name exists with different content; do not overwrite it.');
  } else preset = await api<Rubric>('/api/rubrics', content);
  report.preset = preset; report.status = 'running'; await save();
  console.log(`Saved experimental preset ${preset.id}; ${report.expectedAssessments} planned assessments.`);
  const completed: Job[] = [];
  for (let run = 1; run <= repeats; run++) {
    const created = await api<Job>('/api/jobs', {
      name: `${source.name ?? 'Voice test'} - Anchored v1 run ${run}`,
      profile: { ...source.profile, rubric: preset }, judges: source.judges,
      clipIds: source.clips.map(clip => clip.id), consent: true, enqueue: false,
      clipOverrides: source.clips.map(clip => ({ id: clip.id, voice: clip.voice, language: clip.language })),
    });
    report.experimentIds.push(created.id); await save();
    console.log(`Run ${run}/${repeats}: ${created.id}`);
    const deadline = Date.now() + Math.max(600000, source.clips.length * 190000);
    let job = created, previousCount = -1;
    while (['running', 'queued'].includes(job.status)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${job.id}. The job was not cancelled; inspect it before running anything again.`);
      await delay(5000);
      job = await api<Job>(`/api/jobs/${created.id}`);
      const done = job.results.filter(result => result.status === 'completed' || result.status === 'failed').length;
      if (done !== previousCount) { console.log(`Run ${run}: ${done}/${job.results.length}, ${job.status}`); previousCount = done; }
    }
    if (job.status !== 'completed' || job.results.some(result => result.status !== 'completed' || !result.assessment)) {
      report.status = 'failed'; await save();
      throw new Error(`Run ${job.id} is incomplete or has failed assessments. Stopping without further Azure calls.`);
    }
    completed.push(job);
    console.log(`Run ${run} scores: ${JSON.stringify(summarize(job).map(({ voice, score }) => ({ voice, score })))}`);
  }
  const first = completed[0];
  const { rubric: _experimentalRubric, ...experimentalSettings } = first.profile;
  const { rubric: _baselineRubric, ...baselineSettings } = source.profile;
  if (!isDeepStrictEqual(experimentalSettings, baselineSettings) || !isDeepStrictEqual(first.judges, source.judges))
    throw new Error('Non-rubric settings changed during the experiment.');
  for (const job of completed) for (const result of job.results) {
    const clip = job.clips.find(clip => clip.id === result.clipId)!;
    const originalClip = source.clips.find(original => clipKey(original) === clipKey(clip));
    const original = source.results.find(original => original.clipId === originalClip?.id && original.judgeId === result.judgeId);
    if (!original?.audioDiagnostics?.inputSha256 || original.audioDiagnostics.inputSha256 !== result.audioDiagnostics?.inputSha256 ||
        original.model !== result.model) throw new Error('Experimental audio hash or recorded model differs from baseline.');
  }
  for (const original of baseline) {
    const saved = await api<Job>(`/api/jobs/${original.id}`);
    if (!isDeepStrictEqual(saved, original)) throw new Error(`Baseline ${original.id} changed during the experiment.`);
  }
  report.experimental = compareRuns(completed); report.status = 'completed';
  report.completedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ reportPath, baseline: report.baseline, experimental: report.experimental }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
