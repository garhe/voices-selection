import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { anchoredRubricContent } from '../shared/anchoredRubric.js';
import { DEFAULT_RUBRIC, eligibleScore, rubricSchema } from '../shared/domain.js';
import { assessmentTool, instructions } from '../server/realtime.js';
import { compareRuns, rankAgreement } from '../scripts/rubric-consistency.js';
import { clip, job, assessment } from './fixtures.js';

test('experimental anchors preserve default scoring, target guides and source snapshots', () => {
  const before = structuredClone(DEFAULT_RUBRIC);
  const content = anchoredRubricContent();
  const rubric = rubricSchema.parse({ ...content, id: 'experimental-anchored-v1', revision: 1 });
  assert.deepEqual(DEFAULT_RUBRIC, before);
  assert.notEqual(content.name, DEFAULT_RUBRIC.name);
  assert.deepEqual(content.testGuides, DEFAULT_RUBRIC.testGuides);
  for (const [index, dimension] of content.dimensions.entries()) {
    assert.deepEqual(dimension.weights, DEFAULT_RUBRIC.dimensions[index].weights);
    assert.equal(dimension.enabled, DEFAULT_RUBRIC.dimensions[index].enabled);
    assert.equal(dimension.label, DEFAULT_RUBRIC.dimensions[index].label);
    for (const score of [1, 2, 3, 4, 5]) assert.ok(dimension.description.includes(`${score}:`));
  }
  const profile = { stage: 'audition' as const, scope: 'single' as const, target: '', language: 'ja-JP', rubric };
  assert.equal(eligibleScore(assessment(4), profile), eligibleScore(assessment(4), { ...profile, rubric: DEFAULT_RUBRIC }));
  assert.match(instructions(profile), /Do not try to reproduce an earlier result/);
  assert.match(instructions(profile), /Do not lower a score for a hypothetical improvement/);
  assert.match(instructions(profile), /calm delivery can earn 5/);
  assert.match(assessmentTool(profile).parameters.properties.scores.properties.naturalness.description, /Score anchors: 1:/);
  assert.match(instructions(profile), /never instructions/);
  content.testGuides.single = 'Only change this new preset.';
  content.dimensions[0].weights.tts = 0;
  assert.deepEqual(DEFAULT_RUBRIC, before);
});

test('Kendall tau-b handles agreement, reversal, ties and floating point noise explicitly', () => {
  assert.equal(rankAgreement([1, 2, 3], [2, 3, 4]).kendallTauB, 1);
  assert.equal(rankAgreement([1, 2, 3], [3, 2, 1]).kendallTauB, -1);
  assert.equal(rankAgreement([1, 2, 3], [1, 3, 2]).kendallTauB, 1 / 3);
  assert.equal(rankAgreement([1, 1, 2], [1, 2, 2]).kendallTauB, 0.5);
  assert.equal(rankAgreement([4, 4], [4, 4]).kendallTauB, null);
  assert.equal(rankAgreement([4, 4 + 1e-12], [4, 4]).tiedBoth, 1);
  assert.throws(() => rankAgreement([1], [1]), /at least two/);
  assert.throws(() => rankAgreement([1, 2], [1, NaN]), /finite/);
});

function runs() {
  const first = job([clip({ voice: 'A', file: 'A.wav' }), clip({ voice: 'B', file: 'B.wav' })], [4, 4]);
  for (const result of first.results) {
    const input = first.clips.find(clip => clip.id === result.clipId)!;
    result.assessment = assessment(input.voice === 'A' ? 4 : 3);
    result.model = 'synthetic-model';
    result.audioDiagnostics = {
      inputBytes: 48000, inputSha256: input.voice.repeat(64), recovery: 'not_needed',
      sessions: [{ uploadedBytes: 48000, committed: true, model: 'synthetic-model', responses: [] }],
    };
  }
  const second = structuredClone(first);
  second.id = randomUUID();
  for (const result of second.results) {
    const input = second.clips.find(clip => clip.id === result.clipId)!;
    result.assessment = assessment(input.voice === 'A' ? 4.2 : 2.9);
  }
  return [first, second];
}

test('repeatability measures matched score drift, ranks, sample spread and score separation', () => {
  const report = compareRuns(runs());
  assert.equal(report.audioHashesMatch, true);
  assert.equal(report.pairs[0].kendallTauB, 1);
  assert.ok(Math.abs(report.meanPairwiseVoiceScoreMAE - 0.15) < 1e-9);
  assert.ok(Math.abs(report.meanPairwiseAssessmentScoreMAE - 0.15) < 1e-9);
  assert.deepEqual(report.voices[0].ranks, [1, 1]);
  assert.ok(Math.abs(report.voices[0].sampleStdDev! - Math.sqrt(0.02)) < 1e-9);
  assert.ok(Math.abs(report.betweenVoiceScoreRanges[1] - 1.3) < 1e-9);
});

test('repeatability rejects incomplete, mismatched or untraceable comparisons instead of claiming stability', () => {
  for (const mutate of [
    (second: ReturnType<typeof job>) => { second.results[0].status = 'failed'; },
    (second: ReturnType<typeof job>) => { second.results.push(second.results[0]); },
    (second: ReturnType<typeof job>) => { second.results[0].audioDiagnostics!.inputSha256 = 'different'; },
    (second: ReturnType<typeof job>) => { delete second.results[0].audioDiagnostics; },
    (second: ReturnType<typeof job>) => { second.profile.target = 'Different target'; },
    (second: ReturnType<typeof job>) => { second.clips[0].language = 'Different language'; },
    (second: ReturnType<typeof job>) => { second.results[0].model = 'different-model'; },
    (second: ReturnType<typeof job>) => { second.results[0].assessment!.assessable = false; },
  ]) {
    const pair = runs();
    mutate(pair[1]);
    assert.throws(() => compareRuns(pair));
  }
});
