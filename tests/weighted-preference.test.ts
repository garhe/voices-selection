import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RUBRIC, WEIGHTED_PREFERENCE, eligibleScore, eligibleWeightedScore, summarize, summarizeVoiceEvidence } from '../shared/domain.js';
import { testHistory } from '../shared/history.js';
import { assessment, clip, job, profile } from './fixtures.js';

const close = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-10, `${actual} should equal ${expected}`);
};

test('weighted preference uses the versioned natural/expressive mix without changing original scores', () => {
  assert.equal(WEIGHTED_PREFERENCE.version, 'natural-expressive-v1');
  assert.equal(Object.values(WEIGHTED_PREFERENCE.weights).reduce<number>((sum, weight) => sum + weight, 0), 100);
  const selected = { ...profile, target: 'Warm', targetMarket: 'en-US' };
  const value = assessment();
  value.scores = { naturalness: 5, expressiveness: 4, articulation: 3, pace: 2, contextFit: 1, accentFit: 5, audioQuality: 1 };
  const before = JSON.stringify(value);
  close(eligibleWeightedScore(value, selected), 3.75);
  close(eligibleScore(value, selected), 20 / 6);
  assert.equal(JSON.stringify(value), before);
});

test('inactive targets and excluded rubric dimensions are renormalized, not treated as missing scores', () => {
  const value = assessment(3);
  value.scores.naturalness = 5;
  close(eligibleWeightedScore(value, profile), (35 * 5 + 50 * 3) / 85);
  const rubric = structuredClone(DEFAULT_RUBRIC);
  rubric.dimensions.forEach(d => { d.enabled = d.id === 'naturalness' || d.id === 'pace'; });
  rubric.dimensions[0].weights.audition = 9;
  value.scores.pace = 1;
  value.scores.articulation = null;
  close(eligibleScore(value, { ...profile, rubric }), 4.6);
  close(eligibleWeightedScore(value, { ...profile, rubric }), (35 * 5 + 10) / 45);
});

test('weighted preference preserves original eligibility even for zero-weight audio quality', () => {
  const value = assessment(5);
  close(eligibleScore(value, { ...profile, stage: 'tts' }), 4.2);
  close(eligibleWeightedScore(value, { ...profile, stage: 'tts' }), 5);
  value.scores.audioQuality = null;
  assert.equal(eligibleWeightedScore(value, { ...profile, stage: 'tts' }), null);
  close(eligibleWeightedScore(value, profile), 5);
  value.scores.pace = null;
  assert.equal(eligibleWeightedScore(value, profile), null);
  assert.equal(eligibleWeightedScore({ ...assessment(), languageSupported: false }, profile), null);
  assert.equal(eligibleWeightedScore({ ...assessment(), assessable: false }, profile), null);
  const rubric = structuredClone(DEFAULT_RUBRIC);
  rubric.dimensions.forEach(d => { d.enabled = d.id === 'audioQuality'; d.weights.audition = 1; });
  assert.equal(eligibleScore(assessment(), { ...profile, rubric }), 1);
  assert.equal(eligibleWeightedScore(assessment(), { ...profile, rubric }), null);
});

test('weighted preference averages judges, duration-weights windows and gives each recording equal weight', () => {
  const clips = [clip({ start: 0, end: 1 }), clip({ start: 1, end: 4 }), clip({ file: 'two.wav', end: 30 })];
  const value = job(clips, [3, 5]);
  const rubric = structuredClone(DEFAULT_RUBRIC);
  rubric.dimensions.forEach(d => { d.enabled = d.id === 'naturalness' || d.id === 'pace'; });
  value.profile = { ...profile, rubric };
  for (const result of value.results) {
    result.assessment!.scores.naturalness = result.clipId === clips[0].id ? 1 : result.clipId === clips[1].id ? 5 : 2;
  }
  const summary = summarize(value)[0];
  // Judge-mean pace is 4; first recording's duration-weighted naturalness is 4, second's is 2.
  close(summary.score, 3.5);
  close(summary.weightedScore, (4 + (35 * 2 + 10 * 4) / 45) / 2);
  assert.equal(summary.eligibleFiles, 2);
  const evidence = summarizeVoiceEvidence(value)[0];
  close(evidence.weightedScore, summary.weightedScore!);
  close(evidence.judges[0].weightedScore, (35 * 3 + 10 * 3) / 45);
  close(evidence.judges[1].weightedScore, (35 * 3 + 10 * 5) / 45);
});

test('failed panels or incomplete recordings cannot acquire a weighted score', () => {
  const value = job([clip({ end: 1 }), clip({ start: 1, end: 3 })], [4, 5]);
  value.results[0].status = 'failed';
  const summary = summarize(value)[0];
  assert.equal(summary.score, null);
  assert.equal(summary.weightedScore, null);
  assert.equal(summary.eligibleFiles, 0);
  assert.equal(summarizeVoiceEvidence(value)[0].judges[0].weightedScore, null);
  assert.notEqual(summarizeVoiceEvidence(value)[0].judges[1].weightedScore, null);
});

test('weighted preference excludes unanimously absent windows and keeps roles separate', () => {
  const clips = [
    clip({ role: 'agent', end: 1 }), clip({ role: 'agent', start: 1, end: 2 }),
    clip({ role: 'customer', end: 1 }),
  ];
  const value = job(clips, [4, 4]);
  value.profile = { ...profile, scope: 'both', speakerMode: 'automatic' };
  for (const result of value.results) {
    const source = clips.find(c => c.id === result.clipId)!;
    result.assessment!.speakerAttribution = {
      role: source.role, status: source === clips[1] ? 'not_present' : 'identified', evidence: 'Test attribution.',
    };
    if (source.role === 'customer') result.assessment = {
      ...result.assessment!, scores: assessment(2).scores,
    };
  }
  const summaries = summarize(value);
  const agent = summaries.find(s => s.role === 'agent')!;
  const customer = summaries.find(s => s.role === 'customer')!;
  close(agent.weightedScore, 4);
  close(customer.weightedScore, 2);
  assert.equal(agent.absentWindows, 1);
  value.results[2].assessment!.speakerAttribution!.status = 'uncertain';
  assert.equal(summarize(value).find(s => s.role === 'agent')!.weightedScore, null);
});

test('weighted preference may reverse a ranking but original preference, spread and winner remain unchanged', () => {
  const value = job([clip({ voice: 'Balanced' }), clip({ voice: 'Expressive' })], [3.8, 3.8]);
  for (const result of value.results.filter(r => r.clipId === value.clips[1].id)) {
    result.assessment!.scores = { ...assessment(3).scores, naturalness: 4.5, expressiveness: 4.5, articulation: 2 };
  }
  const before = JSON.stringify(value);
  const [balanced, expressive] = summarize(value);
  assert.equal(balanced.voice, 'Balanced');
  close(balanced.score, 3.8);
  close(expressive.score, 3.5);
  assert.ok(expressive.weightedScore! > balanced.weightedScore!);
  assert.equal(balanced.disagreement, 0);
  assert.equal(expressive.disagreement, 0);
  assert.deepEqual(testHistory(value).bestVoices, [{ voice: 'Balanced', role: 'speaker' }]);
  assert.equal(JSON.stringify(value), before);
});

test('judge disagreement remains a separate signal and does not change weighted preference', () => {
  const agreeing = summarize(job(undefined, [4, 4]))[0];
  const disagreeing = summarize(job(undefined, [3, 5]))[0];
  assert.equal(agreeing.weightedScore, disagreeing.weightedScore);
  assert.equal(agreeing.disagreement, 0);
  assert.equal(disagreeing.disagreement, 2);
});
