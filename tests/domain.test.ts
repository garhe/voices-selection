import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeDimensions, eligibleScore, normalizeAssessment, summarize, summarizeVoiceEvidence, assessmentGaps, claimsMissingAudio, retryableAudioIssue, evaluationName, testNameSchema, resolveLanguageHint, profileSchema, RUBRIC_VERSION } from '../shared/domain.js';
import { measurements, wav } from '../server/audio.js';
import { validateScope } from '../server/app.js';
import { validateRegion } from '../src/audio.js';
import { assessment, clip, job, profile } from './fixtures.js';
import { voiceCoaching, voiceDirectorBriefs, formatDirectorBrief } from '../shared/coaching.js';

test('director briefs turn supported priorities into a concise next-take plan without exposing comparison metadata', () => {
  const value = job([
    clip({ voice: 'PrivateBenchmark', file: 'private-benchmark-path/one.wav' }),
    clip({ voice: 'Talent', file: 'private-talent-path/one.wav' }),
  ], [5, 5]);
  value.rubric = RUBRIC_VERSION;
  value.judges[0].name = 'PrivateJudge';
  value.judges[0].deployment = 'private-deployment';
  for (const result of value.results) if (result.clipId === value.clips[1].id) {
    result.assessment = assessment(4);
    result.assessment.scores.pace = 1;
    result.assessment.scores.expressiveness = 2;
    result.assessment.scores.articulation = 3;
    result.assessment.reasons.pace = 'PrivateJudge compared this with PrivateBenchmark.';
  }
  const snapshot = JSON.stringify(value);
  const before = summarize(value);
  const brief = voiceDirectorBriefs(value).find(b => b.voice === 'Talent')!;
  assert.equal(brief.status, 'ready');
  assert.deepEqual(brief.focus.map(f => f.dimension), ['pace', 'expressiveness', 'articulation']);
  assert.match(brief.summary, /For your next take/);
  assert.match(brief.summary, /comfortable rhythm and pauses/);
  assert.match(brief.summary, /I'd like you to focus first/);
  for (const focus of brief.focus) assert.ok(brief.summary.includes(focus.direction));
  assert.ok(brief.summary.includes(brief.keep[0]));
  assert.match(brief.summary, /Keep the words unchanged and work on one adjustment at a time/);
  assert.ok(brief.keep.includes('Keep the delivery believable and unforced.'));
  assert.equal(brief.takePlan.length, 3);
  assert.match(brief.takePlan[1], /Comfortable rhythm and pauses/);
  assert.ok(brief.focus.every(f => f.direction && f.steps.length >= 2 && f.check));
  assert.match(brief.checklist[0], /script unchanged/);
  const text = formatDirectorBrief(brief);
  assert.ok(text.includes(brief.summary));
  for (const heading of ['DIRECTOR SUMMARY', 'KEEP DOING', 'PERFORMANCE DIRECTIONS', 'YOUR NEXT THREE TAKES', 'BEFORE YOU SEND'])
    assert.ok(text.includes(heading));
  for (const forbidden of [
    'PrivateBenchmark', 'PrivateJudge', 'private-deployment', 'private-benchmark-path', 'private-talent-path',
    'referenceVoice', 'referenceScore', 'candidateScore', 'judgeId', 'matchedFiles', 'referenceEvidence',
    'candidate_judge_evidence', value.judges[0].id, value.judges[1].id,
  ]) {
    assert.equal(JSON.stringify(brief).includes(forbidden), false, forbidden);
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(JSON.stringify(value), snapshot);
  assert.deepEqual(summarize(value), before);
});

test('director briefs preserve supported qualities without inventing a deficit for a leading voice', () => {
  const value = job(undefined, [4, 4]);
  value.rubric = RUBRIC_VERSION;
  const brief = voiceDirectorBriefs(value)[0];
  assert.equal(brief.status, 'maintain');
  assert.deepEqual(brief.focus, []);
  assert.equal(brief.keep.length, 2);
  assert.match(brief.summary, /concentrate on consistency/);
  assert.ok(brief.summary.includes(brief.keep[0]));
  assert.match(brief.summary, /I am not asking you to add effects/);
  assert.equal(brief.takePlan.length, 3);
  assert.match(brief.takePlan[2], /Take 3 - confirmation/);
  assert.equal(formatDirectorBrief(brief).includes('PERFORMANCE DIRECTIONS'), false);
});

test('director briefs flag limited feedback without giving unsupported performance directions', () => {
  const value = job();
  value.results[0].status = 'failed';
  const brief = voiceDirectorBriefs(value)[0];
  assert.equal(brief.status, 'insufficient_feedback');
  assert.deepEqual(brief.focus, []);
  assert.deepEqual(brief.keep, []);
  assert.match(brief.summary, /not enough reliable listening feedback/);
  assert.match(brief.summary, /give me a consistent reading/);
  assert.match(brief.summary, /do not force a different voice/);
  assert.ok(brief.notes.some(note => /Only part of the recording set/.test(note)));
  assert.ok(brief.notes.some(note => /earlier evaluation criteria/.test(note)));
  assert.match(brief.checklist.at(-1)!, /Wait for clearer feedback/);
  value.status = 'running';
  assert.ok(voiceDirectorBriefs(value)[0].notes.some(note => /still in progress/.test(note)));
});

test('director accent guidance includes the explicit delivery and market brief, not another voice as an accent standard', () => {
  const value = job([
    clip({ voice: 'PrivateBenchmark', file: 'benchmark/one.wav' }),
    clip({ voice: 'Talent', file: 'talent/one.wav' }),
  ], [4]);
  value.rubric = RUBRIC_VERSION;
  value.profile = { ...profile, target: 'Warm, calm delivery.', targetMarket: 'UK customers; British English with regional variation.' };
  for (const result of value.results) result.assessment!.scores.contextFit = 4;
  value.results[0].assessment!.scores.accentFit = 5;
  value.results[1].assessment!.scores.accentFit = 2;
  const brief = voiceDirectorBriefs(value).find(b => b.voice === 'Talent')!;
  assert.equal(brief.focus[0].dimension, 'accentFit');
  assert.equal(brief.deliveryTarget, value.profile.target);
  assert.equal(brief.targetMarket, value.profile.targetMarket);
  assert.ok(brief.summary.includes(brief.focus[0].direction));
  const text = formatDirectorBrief(brief);
  assert.match(text, /MARKET \/ ACCENT TARGET/);
  assert.match(text, /UK customers/);
  assert.equal(text.includes('PrivateBenchmark'), false);
  const withoutMarket = { ...value, profile: { ...value.profile, targetMarket: '' } };
  assert.ok(voiceDirectorBriefs(withoutMarket).every(b => b.focus.every(f => f.dimension !== 'accentFit')));
});

test('language hints inherit the evaluation default while preserving explicit recording overrides', () => {
  for (const automatic of ['auto', ' AUTO ', 'Auto'])
    assert.equal(resolveLanguageHint(automatic, ' British English '), 'British English');
  assert.equal(resolveLanguageHint(' Japanese ', 'British English'), 'Japanese');
  assert.equal(resolveLanguageHint('auto', 'auto'), 'auto');
  assert.throws(() => resolveLanguageHint(' ', 'British English'));
  assert.throws(() => resolveLanguageHint('auto', ' '));
  assert.throws(() => profileSchema.parse({ ...profile, language: 'x'.repeat(501) }));
  assert.throws(() => profileSchema.parse({ ...profile, targetMarket: 'x'.repeat(501) }));
});

test('accent fit is independently active and equally weighted only with an explicit market', () => {
  const raw = assessment(4);
  raw.scores.accentFit = 2;
  raw.reasons.accentFit = 'The audible vowel patterns differ from the stated market target.';
  assert.equal(normalizeAssessment(raw, profile).scores.accentFit, null);
  assert.equal(eligibleScore(raw, { ...profile, language: 'British English' }), 4);
  assert.equal(activeDimensions({ ...profile, targetMarket: ' ' }).includes('accentFit'), false);
  for (const stage of ['audition', 'tts'] as const) {
    const value = { ...profile, stage, targetMarket: 'UK customers; British English pronunciation.' };
    const normalized = normalizeAssessment(raw, value);
    assert.equal(normalized.scores.accentFit, 2);
    assert.ok(activeDimensions(value).includes('accentFit'));
    assert.equal(activeDimensions(value).includes('contextFit'), false);
    assert.equal(eligibleScore(normalized, value), stage === 'audition' ? 18 / 5 : 19 / 6);
    normalized.scores.accentFit = null;
    assert.equal(eligibleScore(normalized, value), null);
    const gaps = assessmentGaps({ clipId: 'clip', judgeId: 'judge', status: 'completed', assessment: normalized }, value, 'speaker');
    assert.ok(gaps.some(g => /Target-market accent fit rating missing.*supplied a target market\/accent/.test(g)));
    assert.equal(normalizeAssessment({ ...raw, assessable: false }, value).scores.accentFit, null);
  }
});

test('legacy reports without accent fields retain finite scores and no invented accent evidence', () => {
  const value = job();
  const originalScore = summarize(value)[0].score;
  const legacy = JSON.parse(JSON.stringify(value));
  for (const result of legacy.results) {
    delete result.assessment.scores.accentFit;
    delete result.assessment.reasons.accentFit;
  }
  const snapshot = JSON.stringify(legacy);
  assert.equal(summarize(legacy)[0].score, originalScore);
  assert.equal(summarize(legacy)[0].dimensions.accentFit, null);
  assert.ok(summarizeVoiceEvidence(legacy)[0].judges.every(j => j.dimensions.every(d => d.dimension !== 'accentFit')));
  assert.equal(JSON.stringify(legacy), snapshot);
  assert.throws(() => normalizeAssessment(legacy.results[0].assessment, profile), 'New assessments must include the current schema fields.');
});

test('market-accent coaching carries original evidence and uses the explicit market, not reference identity', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'Reference/one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/one.wav' }),
  ], [4]);
  value.rubric = RUBRIC_VERSION;
  value.profile = { ...profile, targetMarket: 'UK customers; broadly British English.' };
  value.results[0].assessment!.scores.accentFit = 5;
  value.results[1].assessment!.scores.accentFit = 2;
  value.results[1].assessment!.reasons.accentFit = 'Vowel patterns differ from the explicit target.';
  const report = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.equal(report.priorities[0].dimension, 'accentFit');
  assert.equal(report.priorities[0].gap, 3);
  assert.match(report.priorities[0].steps.join(' '), /explicit target market\/accent/);
  assert.match(report.priorities[0].check, /listeners familiar with the intended market/);
  assert.equal(report.priorities[0].evidence[0].notes[0].text, 'Vowel patterns differ from the explicit target.');
});

test('missing-audio recovery recognizes explicit delivery claims, not genuine speech or language limitations', () => {
  const value = assessment();
  value.assessable = false;
  for (const text of [
    'No actual audio was presented for evaluation, only conversational content.',
    'No audio content was provided in this window.',
    'The assessment is based on a non-audio representation of the interaction.',
    'This window appears as text without an audible recording.',
    'Without the original audio, language detection is unreliable.',
    'Audio was not included in the window.',
    'I cannot access the audio.',
    'This window appears as text content without an accompanying audible signal.',
    'This assessment is limited by lack of audible audio content for the requested role.',
    'The agent’s spoken audio is not audibly available in this window.',
    'No audible recording was available.',
  ]) {
    value.limitations = [text];
    assert.equal(claimsMissingAudio(value), true, text);
  }
  for (const text of [
    'Insufficient audible evidence of the agent’s actual vocal performance.',
    'The recording is silent.',
    'Speech is too quiet and obscured by noise.',
    'I cannot reliably understand the spoken language.',
    'Overlapping speakers make role attribution uncertain.',
    'There is no agent speech in this window.',
  ]) {
    value.limitations = [text];
    assert.equal(claimsMissingAudio(value), false, text);
  }
  value.limitations = ['No audio was provided.'];
  value.speakerAttribution = { role: 'agent', status: 'not_present', evidence: 'Only the customer speaks.' };
  assert.equal(claimsMissingAudio(value), false);
  delete value.speakerAttribution;
  const result = { clipId: 'clip', judgeId: 'judge', status: 'completed' as const, assessment: value };
  assert.equal(retryableAudioIssue(result), true);
  assert.equal(retryableAudioIssue({ ...result, status: 'failed' }), false);
  const gaps = assessmentGaps(result, profile, 'speaker');
  assert.ok(gaps.some(g => g.includes('receipt is not confirmed')));
});

test('coaching ranks positive dimension gaps and preserves attributed evidence without changing assessments', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'collection/Reference/one.wav' }),
    clip({ voice: 'Candidate', file: 'collection/Candidate/one.wav' }),
  ], [5, 5]);
  for (const r of value.results) if (r.clipId === value.clips[1].id) {
    r.assessment = assessment(4);
    r.assessment.scores.pace = 2;
    r.assessment.reasons.pace = 'Rushed at thought boundaries.';
  }
  const original = JSON.stringify(value);
  const reports = voiceCoaching(value);
  const candidate = reports.find(r => r.voice === 'Candidate')!;
  assert.equal(candidate.referenceVoice, 'Reference');
  assert.deepEqual(candidate.matchedFiles, ['one.wav']);
  assert.equal(candidate.priorities[0].dimension, 'pace');
  assert.equal(candidate.priorities[0].gap, 3);
  assert.equal(candidate.priorities[0].evidence[0].judgeId, value.judges[0].id);
  assert.equal(candidate.priorities[0].evidence[0].notes[0].text, 'Rushed at thought boundaries.');
  assert.deepEqual(candidate.priorities[0].evidence[0].notes[0].files, ['collection/Candidate/one.wav']);
  assert.deepEqual(candidate.priorities[0].referenceEvidence[0].notes[0].files, ['collection/Reference/one.wav']);
  assert.match(candidate.priorities[0].steps.join(' '), /faster.*slower/);
  assert.ok(candidate.priorities.every(p => p.steps.length >= 2 && p.check.length > 0));
  assert.deepEqual(reports.find(r => r.voice === 'Reference')!.priorities, []);
  assert.equal(JSON.stringify(value), original);
});

test('coaching compares shared eligible files, not mismatched overall averages', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'Reference/one.wav' }),
    clip({ voice: 'Reference', file: 'Reference/two.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/three.wav' }),
  ], [5]);
  for (const r of value.results) r.assessment = assessment(
    r.clipId === value.clips[0].id ? 2 : r.clipId === value.clips[2].id ? 3 : r.clipId === value.clips[3].id ? 1 : 5,
  );
  const report = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.equal(report.referenceVoice, 'Reference');
  assert.equal(report.candidateScore, 3);
  assert.equal(report.referenceScore, 2);
  assert.deepEqual(report.priorities, []);
  assert.match(report.status, /No lower active-dimension/);
  assert.ok(report.warnings.some(w => w.includes('different recording sets')));
});

test('coaching excludes failed full-panel pairs and their stale evidence', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'Reference/one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/one.wav' }),
  ], [5, 4]);
  value.results[2].status = 'failed';
  const report = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.equal(report.candidateScore, null);
  assert.deepEqual(report.priorities, []);
  assert.deepEqual(report.matchedFiles, []);
  assert.match(report.status, /No shared, eligible/);
  assert.ok(report.warnings.some(w => w.includes('coverage is incomplete')));
  assert.equal(JSON.stringify(report).includes('Fluid delivery.'), false);
});

test('coaching requires a scoreable same-role reference and keeps tied references explicit', () => {
  const value = job([
    clip({ voice: 'Zebra', role: 'agent' }),
    clip({ voice: 'Alpha', role: 'agent' }),
    clip({ voice: 'Customer', role: 'customer' }),
  ], [4]);
  value.profile = { ...profile, scope: 'both' };
  value.status = 'running';
  value.results[2].status = 'failed';
  const reports = voiceCoaching(value);
  const agent = reports.find(r => r.voice === 'Zebra')!;
  assert.equal(agent.referenceVoice, 'Alpha');
  assert.ok(agent.warnings.some(w => w.includes('tied')));
  assert.ok(agent.warnings.some(w => w.includes('provisional')));
  assert.equal(reports.find(r => r.voice === 'Customer')!.referenceVoice, null);
});

test('coaching rejects ambiguous basename pairs and different reported language sets', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'Reference/one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/a/one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/b/one.wav' }),
    clip({ voice: 'Reference', file: 'Reference/two.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/two.wav' }),
  ], [5]);
  value.results[4].assessment!.language = 'Thai';
  const report = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.equal(report.referenceVoice, 'Candidate');
  // Make the reference uniquely higher so ambiguous cross-voice pairs are tested.
  for (const r of value.results) if ([1, 2, 4].some(i => value.clips[i].id === r.clipId)) r.assessment!.scores.pace = 2;
  const comparison = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.deepEqual(comparison.matchedFiles, []);
  assert.ok(comparison.warnings.some(w => w.includes('Duplicate filenames')));
  assert.ok(comparison.warnings.some(w => w.includes('language sets were excluded')));
});

test('coaching follows active dimensions, supports Windows filenames and omits inactive target and audition fidelity', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'Reference\\one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate\\one.wav' }),
  ], [5]);
  const own = value.results[1].assessment!;
  own.scores.audioQuality = 1;
  value.results[0].assessment!.scores.audioQuality = 5;
  assert.deepEqual(voiceCoaching(value).find(r => r.voice === 'Candidate')!.priorities, []);
  value.profile = { ...profile, stage: 'tts', target: 'Calm and reassuring.' };
  value.results[0].assessment!.scores.contextFit = 5;
  own.scores.contextFit = 2;
  const report = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.deepEqual(report.matchedFiles, ['one.wav']);
  assert.deepEqual(report.priorities.map(p => p.dimension), ['audioQuality', 'contextFit']);
});

test('coaching keeps voice-persona exercises separate from historical scores and script changes', () => {
  const value = job([
    clip({ voice: 'Reference', file: 'Reference/one.wav' }),
    clip({ voice: 'Candidate', file: 'Candidate/one.wav' }),
  ], [5]);
  value.results[1].assessment = assessment(3);
  const historical = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.ok(historical.warnings.some(w => w.includes('earlier rubric')));
  value.rubric = RUBRIC_VERSION;
  const current = voiceCoaching(value).find(r => r.voice === 'Candidate')!;
  assert.equal(current.warnings.some(w => w.includes('earlier rubric')), false);
  assert.match(current.priorities.find(p => p.dimension === 'naturalness')!.steps[0], /Keep the script unchanged/);
  assert.match(current.priorities.find(p => p.dimension === 'expressiveness')!.check, /not the sentiment of the words/);
  assert.match(current.priorities.find(p => p.dimension === 'pace')!.check, /without judging how logical or informative/);
});

test('test names are required for new runs and legacy runs have a display name', () => {
  assert.equal(testNameSchema.parse('  Round 1  '), 'Round 1');
  assert.equal(testNameSchema.parse('a'.repeat(120)).length, 120);
  assert.throws(() => testNameSchema.parse('   '));
  assert.throws(() => testNameSchema.parse('a'.repeat(121)));
  assert.equal(evaluationName(job()), 'Untitled evaluation');
  assert.equal(evaluationName({ name: 'Round 1' }), 'Round 1');
});

test('audition excludes microphone quality, TTS includes it, absent target is excluded', () => {
  assert.equal(eligibleScore(assessment(5), profile), 5);
  assert.equal(eligibleScore(assessment(5), { ...profile, stage: 'tts' }), 4.2);
  assert.equal(activeDimensions(profile).includes('contextFit'), false);
  assert.equal(eligibleScore(assessment(5), { ...profile, target: 'Warm' }), null);
});
test('unsupported languages and obscured speech never enter preference scores', () => {
  const raw = assessment(); raw.languageSupported = false;
  const value = normalizeAssessment(raw, profile);
  assert.equal(value.scores.articulation, null);
  assert.equal(value.scores.audioQuality, 1);
  assert.equal(eligibleScore(value, profile), null);
  const obscured = assessment(); obscured.scores.articulation = null;
  assert.equal(eligibleScore(obscured, profile), null);
});
test('scores reject invalid shape, values, and fabricated missing fields', () => {
  assert.throws(() => normalizeAssessment({ ...assessment(), scores: { naturalness: 8 } }, profile));
  assert.throws(() => normalizeAssessment({ ...assessment(), extra: 'unexpected' }, profile));
});
test('panel consensus averages judges, and separates agent from customer', () => {
  const value = job([clip({ role: 'agent' }), clip({ role: 'customer' })]);
  value.profile = { ...profile, scope: 'both' };
  const result = summarize(value);
  assert.equal(result.length, 2);
  assert.equal(result[0].score, 3);
  assert.equal(result[0].disagreement, 2);
});
test('regions are duration-weighted within recording and recordings are equal-weighted', () => {
  const clips = [
    clip({ start: 0, end: 1 }), clip({ start: 1, end: 4 }), clip({ file: 'two.wav', start: 0, end: 30 }),
  ];
  const value = job(clips, [5, 5]);
  for (const r of value.results) r.assessment = assessment(r.clipId === clips[0].id ? 1 : r.clipId === clips[1].id ? 5 : 2);
  const result = summarize(value)[0];
  // First recording: (1*1 + 5*3)/4 = 4. Second recording: 2. Equal-file mean: 3.
  assert.equal(result.score, 3);
  assert.equal(result.files, 2);
  assert.equal(result.eligibleFiles, 2);
});
test('a failed or unassessable judge excludes a recording rather than silently changing panel', () => {
  const value = job();
  value.results[1].status = 'failed';
  assert.equal(summarize(value)[0].score, null);
  assert.equal(summarize(value)[0].eligibleFiles, 0);
  value.results[1].status = 'completed';
  value.results[1].assessment!.assessable = false;
  assert.equal(summarize(value)[0].score, null);
});
test('a missing region excludes the full recording, not just the failed region', () => {
  const value = job([clip(), clip({ start: 1, end: 2 })]);
  value.results[2].status = 'failed';
  assert.equal(summarize(value)[0].score, null);
});
test('scope validation requires both roles, rejects overlap and wrong roles', () => {
  assert.throws(() => validateScope({ ...profile, scope: 'both' }, [clip({ role: 'agent' })]), /each selected role/);
  assert.throws(() => validateScope(profile, [clip({ role: 'customer' })]), /scope/);
  assert.throws(() => validateScope(profile, [clip(), clip({ start: 0.5, end: 1.5 })]), /overlap/);
  assert.doesNotThrow(() => validateScope({ ...profile, scope: 'both' }, [clip({ role: 'agent' }), clip({ role: 'customer' })]));
});
test('audio has explicit bounds and channel checks', () => {
  const region = { id: 'test', role: 'agent' as const, start: 0, end: 1, channel: 'mix' as const, confirmed: true };
  assert.doesNotThrow(() => validateRegion(region, 1, 1));
  assert.throws(() => validateRegion({ ...region, channel: 'right' }, 1, 1), /right channel/);
  assert.throws(() => validateRegion({ ...region, end: 121 }, 200, 2), /120/);
  assert.throws(() => validateRegion({ ...region, start: NaN }, 200, 2));
});
test('PCM diagnostics and WAV output use exact sample rate and avoid nonfinite JSON', () => {
  const silence = Buffer.alloc(48000);
  const value = measurements(silence);
  assert.equal(value.seconds, 1); assert.equal(value.rmsDb, null); assert.equal(value.quietPercent, 100);
  const encoded = wav(silence);
  assert.equal(encoded.toString('ascii', 0, 4), 'RIFF');
  assert.equal(encoded.readUInt32LE(24), 24000);
  assert.equal(encoded.readUInt32LE(40), 48000);
  assert.equal(encoded.length, 48044);
});

test('voice evidence groups repeated comments by recording, not windows, and preserves independent judges', () => {
  const value = job([clip(), clip({ start: 1, end: 2 }), clip({ file: 'two.wav' })], [4, 2]);
  const evidence = summarizeVoiceEvidence(value)[0];
  assert.equal(evidence.files, 2);
  assert.equal(evidence.eligibleFiles, 2);
  assert.equal(evidence.score, 3);
  assert.equal(evidence.judges[0].scoredFiles, 2);
  assert.equal(evidence.judges[0].score, 4);
  assert.equal(evidence.judges[1].score, 2);
  assert.equal(evidence.judges[0].observations.length, 1);
  assert.equal(evidence.judges[0].observations[0].files.length, 2);
  assert.equal(evidence.judges[0].dimensions.find(d => d.dimension === 'naturalness')!.score, 4);
  assert.equal(evidence.judges[1].dimensions.find(d => d.dimension === 'naturalness')!.score, 2);
  assert.equal(evidence.judges[0].dimensions.find(d => d.dimension === 'audioQuality')!.diagnostic, true);
  assert.equal(evidence.judges[0].gaps.length, 0);
});

test('missing target-style ratings are explained without inventing scores or discarding other judge comments', () => {
  const value = job([clip({ file: 'one.wav' }), clip({ file: 'two.wav' }), clip({ file: 'three.wav' })]);
  value.profile = { ...profile, target: 'Calm service delivery' };
  for (const result of value.results) result.assessment!.scores.contextFit = 4;
  value.results[0].assessment!.scores.contextFit = null;
  value.results[0].assessment!.reasons.contextFit = 'No target was supplied.';
  const evidence = summarizeVoiceEvidence(value)[0];
  assert.equal(evidence.eligibleFiles, 2);
  assert.equal(evidence.judges[0].scoredFiles, 2);
  assert.equal(evidence.judges[1].scoredFiles, 3);
  assert.equal(evidence.judges[0].gaps.length, 1);
  assert.match(evidence.judges[0].gaps[0].text, /test supplied a target/);
  assert.deepEqual(evidence.judges[0].gaps[0].files, ['one.wav']);
  assert.equal(value.results[0].assessment!.scores.contextFit, null);
  assert.equal(evidence.judges[0].observations[0].files.length, 3);
});

test('voice evidence separates voices and roles, and ignores stale comments on failed assessments', () => {
  const value = job([clip({ role: 'agent' }), clip({ role: 'customer' }), clip({ role: 'agent', voice: 'Other' })]);
  value.profile = { ...profile, scope: 'both' };
  value.results[0].status = 'failed'; value.results[0].error = 'Connection closed.';
  value.results[0].assessment!.observations = ['Stale comment must not appear.'];
  value.results[2].assessment!.observations = ['Customer-specific evidence.'];
  value.results[4].assessment!.observations = ['Other voice evidence.'];
  const evidence = summarizeVoiceEvidence(value);
  const agent = evidence.find(e => e.voice === 'Candidate A' && e.role === 'agent')!;
  const customer = evidence.find(e => e.voice === 'Candidate A' && e.role === 'customer')!;
  assert.equal(evidence.length, 3);
  assert.equal(agent.judges[0].observations.length, 0);
  assert.match(agent.judges[0].gaps[0].text, /Connection closed/);
  assert.equal(customer.judges[0].observations[0].text, 'Customer-specific evidence.');
  assert.equal(evidence.find(e => e.voice === 'Other')!.judges[0].observations[0].text, 'Other voice evidence.');
});

test('scoring gap explanations distinguish processing state, role uncertainty and unsupported languages', () => {
  const value = job();
  const result = value.results[0];
  assert.match(assessmentGaps(undefined, profile, 'speaker')[0], /missing/);
  result.status = 'pending';
  assert.match(assessmentGaps(result, profile, 'speaker')[0], /pending/);
  result.status = 'completed';
  result.assessment!.speakerAttribution = { role: 'speaker', status: 'uncertain', evidence: 'Two speakers share the same role.' };
  result.assessment!.assessable = false;
  const gaps = assessmentGaps(result, { ...profile, speakerMode: 'automatic' }, 'speaker');
  assert.ok(gaps.some(g => /uncertain/.test(g)));
  assert.ok(gaps.some(g => /insufficient assessable/.test(g)));
  result.assessment!.languageSupported = false;
  assert.ok(assessmentGaps(result, profile, 'speaker').some(g => /audio language/.test(g)));
  assert.deepEqual(summarizeVoiceEvidence({ ...value, clips: [] }), []);
});

test('matrix scores preserve duration weighting, eligible-file coverage and diagnostic-only audition quality', () => {
  const clips = [clip({ start: 0, end: 1 }), clip({ start: 1, end: 4 }), clip({ file: 'two.wav' })];
  const value = job(clips, [5, 3]);
  value.results[0].assessment = assessment(1);
  const before = JSON.stringify(value);
  const evidence = summarizeVoiceEvidence(value)[0];
  // Judge 1: ((1*1 + 5*3)/4 + 5)/2 = 4.5. Judge 2: 3. Panel: 3.75.
  assert.equal(evidence.score, 3.75);
  assert.equal(evidence.judges[0].score, 4.5);
  assert.equal(evidence.judges[1].score, 3);
  assert.equal(JSON.stringify(value), before);
  value.results[1].status = 'failed';
  value.results[1].assessment!.observations = ['Stale evidence.'];
  const partial = summarizeVoiceEvidence(value)[0];
  assert.equal(partial.score, 4);
  assert.equal(partial.eligibleFiles, 1);
  assert.equal(partial.judges[0].score, 4.5);
  assert.equal(partial.judges[0].scoredFiles, 2);
  assert.equal(partial.judges[1].score, 3);
  assert.equal(partial.judges[1].scoredFiles, 1);
  assert.ok(partial.judges[1].observations.every(note => note.text !== 'Stale evidence.'));
  const ttsScore = summarizeVoiceEvidence({ ...value, profile: { ...profile, stage: 'tts' } })[0].judges[0].score;
  assert.ok(ttsScore !== null && Math.abs(ttsScore - 3.8) < 1e-12);
});

test('matrix retains conflicting original comments and explicit missing scores instead of inventing pros and cons', () => {
  const value = job();
  value.profile = { ...profile, target: 'Natural service voice' };
  value.results[0].assessment!.observations = ['Natural pacing; occasional rushing.'];
  value.results[1].assessment!.observations = ['Pacing is consistently too slow.'];
  value.results[0].assessment!.reasons.pace = 'Natural, but rushed in places.';
  const before = JSON.stringify(value);
  const evidence = summarizeVoiceEvidence(value)[0];
  assert.equal(evidence.score, null);
  assert.equal(evidence.eligibleFiles, 0);
  assert.ok(evidence.judges.every(judge => judge.score === null && judge.scoredFiles === 0));
  assert.equal(evidence.judges[0].observations[0].text, 'Natural pacing; occasional rushing.');
  assert.equal(evidence.judges[1].observations[0].text, 'Pacing is consistently too slow.');
  assert.equal(evidence.judges[0].dimensions.find(d => d.dimension === 'pace')!.reasons[0].text, 'Natural, but rushed in places.');
  assert.ok(evidence.judges[0].gaps.some(note => note.text.includes('the test supplied a target')));
  assert.equal(JSON.stringify(value), before);
});
