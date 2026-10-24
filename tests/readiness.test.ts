import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyLanguageHint, evaluationBlockers, recordingReviewed, withLanguageAccent, withTestNameLanguage, DEFAULT_TEST_GUIDE, SINGLE_SPEAKER_TEST_GUIDE, withSpeakerScope, withRubric } from '../src/readiness.js';
import { activeDimensions, eligibleScore, profileSchema, rubricSchema, DEFAULT_RUBRIC, BOTH_SPEAKERS_TEST_GUIDE } from '../shared/domain.js';
import type { Region } from '../src/audio.js';
import { assessment, clip, profile as baseProfile } from './fixtures.js';

const profile = { ...baseProfile, target: 'Warm, calm and conversational.' };

test('editable rubric drafts use yes/no equal contributions without changing saved source weights', () => {
  const saved = structuredClone(DEFAULT_RUBRIC);
  saved.dimensions.forEach(d => { d.enabled = ['naturalness', 'pace'].includes(d.id); });
  saved.dimensions[0].weights = { audition: 9, tts: 1.5 };
  const snapshot = JSON.stringify(saved);
  const draft = withRubric(profile, saved);
  assert.ok(draft.rubric!.dimensions.every(d => [0, 1].includes(d.weights.audition) && [0, 1].includes(d.weights.tts)));
  assert.equal(draft.rubric!.dimensions.find(d => d.id === 'audioQuality')!.weights.audition, 0);
  assert.equal(draft.rubric!.dimensions[1].enabled, false);
  const value = assessment(1); value.scores.pace = 5;
  assert.equal(eligibleScore(value, draft), 3);
  assert.equal(eligibleScore(value, { ...profile, rubric: saved }), 1.4);
  assert.equal(JSON.stringify(saved), snapshot);
});

test('single-speaker scope automatically gets its own default guide without overwriting custom guidance', () => {
  const agent = { ...profile, scope: 'agent' as const, target: DEFAULT_TEST_GUIDE };
  const single = withSpeakerScope(agent, 'single');
  assert.equal(single.target, SINGLE_SPEAKER_TEST_GUIDE);
  assert.match(single.target, /one speaker/);
  assert.doesNotMatch(single.target, /customer|only the agent/);
  assert.equal(withSpeakerScope(single, 'agent').target, DEFAULT_TEST_GUIDE);
  assert.equal(withSpeakerScope({ ...single, target: 'Keep a restrained, warm tone.' }, 'agent').target, 'Keep a restrained, warm tone.');
  assert.equal(agent.target, DEFAULT_TEST_GUIDE);
});

test('switching and editing rubrics updates only default guides and preserves the matching speaker scope', () => {
  const rubric = structuredClone(DEFAULT_RUBRIC);
  rubric.testGuides = { conversation: 'Custom conversation style.', single: 'Custom single-speaker style.', both: 'Custom separate-speaker style.' };
  const single = withRubric({ ...profile, target: SINGLE_SPEAKER_TEST_GUIDE }, rubric);
  assert.equal(single.target, rubric.testGuides.single);
  const agent = withSpeakerScope(single, 'agent');
  assert.equal(agent.target, rubric.testGuides.conversation);
  const both = withSpeakerScope(agent, 'both');
  assert.equal(both.target, rubric.testGuides.both);
  assert.equal(withSpeakerScope(both, 'single').target, rubric.testGuides.single);
  assert.equal(withRubric(both, DEFAULT_RUBRIC).target, BOTH_SPEAKERS_TEST_GUIDE);
  const edited = { ...rubric, testGuides: { ...rubric.testGuides, single: 'Updated single-speaker style.' } };
  assert.equal(withRubric(single, edited).target, edited.testGuides.single);
  assert.equal(withRubric({ ...single, target: 'My manual style.' }, DEFAULT_RUBRIC).target, 'My manual style.');
});

test('both-speaker defaults score each role independently and preserve manual guidance', () => {
  const agent = { ...profile, scope: 'agent' as const, target: DEFAULT_TEST_GUIDE };
  const both = withSpeakerScope(agent, 'both');
  assert.equal(both.target, BOTH_SPEAKERS_TEST_GUIDE);
  assert.match(both.target, /Evaluate the agent and customer separately/);
  assert.match(both.target, /score only the requested speaker/);
  assert.doesNotMatch(both.target, /Evaluate only the agent|Do not evaluate or score the customer/);
  assert.equal(withSpeakerScope(both, 'agent').target, DEFAULT_TEST_GUIDE);
  assert.equal(withSpeakerScope({ ...agent, target: 'Keep my custom guide.' }, 'both').target, 'Keep my custom guide.');
  assert.equal(withRubric({ ...both, target: 'My manual style.' }, DEFAULT_RUBRIC).target, 'My manual style.');
  assert.equal(withRubric({ ...both, target: DEFAULT_TEST_GUIDE }, DEFAULT_RUBRIC).target, BOTH_SPEAKERS_TEST_GUIDE);
  assert.ok(profileSchema.safeParse(both).success);
});

test('older rubric snapshots load with a both-speaker default without changing saved targets', () => {
  const { both, ...oldGuides } = DEFAULT_RUBRIC.testGuides;
  const legacyRubric = { ...DEFAULT_RUBRIC, testGuides: oldGuides };
  const parsed = rubricSchema.parse(legacyRubric);
  assert.equal(parsed.testGuides.both, BOTH_SPEAKERS_TEST_GUIDE);
  const saved = profileSchema.parse({ ...profile, scope: 'both', target: DEFAULT_TEST_GUIDE, rubric: legacyRubric });
  assert.equal(saved.target, DEFAULT_TEST_GUIDE);
  assert.equal(withRubric(saved, parsed).target, BOTH_SPEAKERS_TEST_GUIDE);
  assert.ok(profileSchema.safeParse({ ...saved, scope: 'customer' }).success);
  assert.equal('both' in oldGuides, false);
});

test('test-name locales populate listening language and accent fit without changing the guide or scope', () => {
  const original = { ...profile, scope: 'agent' as const, target: DEFAULT_TEST_GUIDE };
  for (const [name, expected] of [
    ['ko-KR Female VTS', 'ko-KR'], ['thTH Male Cartesia', 'th-TH'],
    ['zh_Hant_TW Female', 'zh-Hant-TW'], ['en-GB Male', 'en-GB'],
    ['No locale', 'auto'], ['en-US and ko-KR', 'auto'],
  ]) {
    const next = withTestNameLanguage(original, name);
    assert.equal(next.language, expected);
    assert.equal(next.targetMarket, expected === 'auto' ? '' : expected);
    assert.equal(next.target, DEFAULT_TEST_GUIDE);
    assert.equal(next.scope, 'agent');
  }
  const override = withLanguageAccent(withTestNameLanguage(original, 'ko-KR Female'), 'Italian for Italy');
  assert.equal(override.language, 'Italian for Italy');
  assert.equal(original.language, 'auto');
  assert.ok(profileSchema.safeParse({ ...original, language: 'ko-KR' }).success);
  assert.match(DEFAULT_TEST_GUIDE, /\*\*Evaluate only the agent’s voice\*\*/);
  assert.match(DEFAULT_TEST_GUIDE, /\*\*Do not evaluate or score the customer’s voice or speaking behavior\.\*\*/);
});

function region(role: Region['role'] = 'speaker', confirmed = true): Region {
  return { id: randomUUID(), role, confirmed, start: 0, end: 1, channel: 'mix' };
}
function readyInput(): Parameters<typeof evaluationBlockers>[0] {
  return {
    name: 'Audition round 1', profile,
    config: { configured: true, judges: [{ id: randomUUID(), name: 'Judge', deployment: 'judge-deployment' }] },
    recordings: [{ include: true, regions: [region()] }],
    scope: 'single', consent: true, busy: false, running: false,
  };
}
test('a complete setup is startable and every disabled condition has an explanation', () => {
  assert.deepEqual(evaluationBlockers(readyInput()), []);
  const input = readyInput();
  input.name = ''; input.config = undefined; input.recordings = []; input.consent = false;
  const blockers = evaluationBlockers(input);
  assert.equal(blockers.length, 4);
  assert.ok(blockers.some(b => /test name/.test(b)));
  assert.ok(blockers.some(b => /Azure settings/.test(b)));
  assert.ok(blockers.some(b => /audio folder/.test(b)));
  assert.ok(blockers.some(b => /permission checkbox/.test(b)));
});
test('a missing or whitespace-only target guide blocks imported and saved inputs in both stages and modes', () => {
  for (const stage of ['audition', 'tts'] as const) for (const speakerMode of ['manual', 'automatic'] as const) {
    for (const target of ['', '   ']) for (const saved of [false, true]) {
      const input = readyInput();
      input.profile = { ...profile, stage, speakerMode, target };
      input.speakerMode = speakerMode;
      if (saved) input.savedClips = [{ ...clip(), include: true }];
      assert.ok(evaluationBlockers(input).some(b => /target vocal style or test guide/.test(b)));
    }
  }
  assert.equal(profileSchema.parse({ ...profile, target: ' Warm delivery. ' }).target, 'Warm delivery.');
  assert.equal(profileSchema.safeParse({ ...profile, target: 'x'.repeat(1501) }).success, false);
});
test('one language/accent value drives listening and accent fit without changing other setup settings', () => {
  const original = { ...profile, stage: 'tts' as const, speakerMode: 'automatic' as const, target: 'Warm and calm.', language: 'Italian', targetMarket: 'Italian for Italy' };
  const snapshot = JSON.stringify(original);
  const next = withLanguageAccent(original, 'British English');
  assert.equal(next.language, 'British English');
  assert.equal(next.targetMarket, 'British English');
  assert.equal(next.stage, original.stage);
  assert.equal(next.speakerMode, original.speakerMode);
  assert.equal(next.target, original.target);
  assert.ok(activeDimensions(next).includes('accentFit'));
  assert.equal(JSON.stringify(original), snapshot);
  for (const value of ['auto', ' AUTO ', 'Auto']) {
    const automatic = withLanguageAccent(next, value);
    assert.equal(automatic.targetMarket, '');
    assert.equal(activeDimensions(automatic).includes('accentFit'), false);
    assert.equal(profileSchema.parse(automatic).language, value.trim());
  }
  assert.equal(profileSchema.safeParse(withLanguageAccent(next, '')).success, false);
});
test('saved setup conversion preserves full accent criteria, or uses its language when no market was supplied', () => {
  const market = 'British English; acceptable regional variation. '.repeat(10).trim();
  assert.ok(market.length > 100 && market.length <= 500);
  const previous = { ...profile, language: 'English', targetMarket: market };
  const next = profileSchema.parse(withLanguageAccent(previous));
  assert.equal(next.language, market);
  assert.equal(next.targetMarket, market);
  assert.equal(previous.language, 'English');
  assert.equal(withLanguageAccent({ ...profile, language: 'Japanese' }).targetMarket, 'Japanese');
  assert.equal(withLanguageAccent(profile).targetMarket, '');
  assert.equal(profileSchema.parse(withLanguageAccent(profile, 'x'.repeat(500))).language.length, 500);
  assert.equal(profileSchema.safeParse(withLanguageAccent(profile, 'x'.repeat(501))).success, false);
});
test('bulk language hints cover saved and imported inputs without changing selection, ranges or originals', () => {
  const saved = [
    { ...clip({ language: 'auto' }), include: true },
    { ...clip({ language: 'Italian', start: 1, end: 2 }), include: false },
  ];
  const original = JSON.stringify(saved);
  const updated = applyLanguageHint(saved, ' British English ');
  assert.deepEqual(updated.map(c => c.language), ['British English', 'British English']);
  assert.equal(JSON.stringify(saved), original);
  assert.deepEqual(updated.map(({ language, ...rest }) => rest), saved.map(({ language, ...rest }) => rest));
  updated[1].language = 'Welsh English';
  assert.equal(updated[0].language, 'British English', 'Individual overrides remain independent.');
  const imported = [{ id: 'one', language: 'auto', include: true, regions: [region()] }];
  assert.deepEqual(applyLanguageHint(imported, 'Japanese'), [{ ...imported[0], language: 'Japanese' }]);
  assert.throws(() => applyLanguageHint(saved, ' '));
  assert.throws(() => applyLanguageHint(saved, 'x'.repeat(501)));
});
test('setup reports invalid global language hints and overlong market descriptions before starting', () => {
  const input = readyInput();
  input.profile = { ...profile, language: ' ', targetMarket: 'x'.repeat(501) };
  const blockers = evaluationBlockers(input);
  assert.ok(blockers.some(b => /language:/.test(b)));
  assert.ok(blockers.some(b => /targetMarket:/.test(b)));
});
test('region checklist reports exact remaining count and ignores excluded recordings', () => {
  const input = readyInput();
  input.recordings.push({ include: true, regions: [region('speaker', false)] }, { include: false, regions: [] });
  assert.match(evaluationBlockers(input)[0], /1 remaining recording \(1\/2 reviewed\)/);
  input.recordings[1].regions[0].confirmed = true;
  assert.deepEqual(evaluationBlockers(input), []);
});
test('both-speaker scope requires confirmed agent and customer regions, including after deletion', () => {
  const recording = { regions: [region('agent'), region('customer')] };
  assert.equal(recordingReviewed(recording, 'both'), true);
  recording.regions.pop();
  assert.equal(recordingReviewed(recording, 'both'), false);
  assert.equal(recordingReviewed(recording, 'agent'), true);
  assert.equal(recordingReviewed(recording, 'single'), false);
  assert.equal(recordingReviewed({ regions: [] }, 'single'), false);
  const input = readyInput(); input.scope = 'both'; input.recordings = [{ ...recording, include: true }];
  assert.match(evaluationBlockers(input)[0], /Confirm speaker regions/);
});
test('invalid panel, missing credentials, busy state and running evaluations explain their blockers', () => {
  const input = readyInput();
  input.config!.configured = false; input.config!.judges[0].deployment = '';
  input.busy = true; input.running = true;
  const blockers = evaluationBlockers(input);
  assert.equal(blockers.length, 4);
  assert.ok(blockers.some(b => /endpoint and API key/.test(b)));
  assert.ok(blockers.some(b => /deployment name/.test(b)));
  assert.ok(blockers.some(b => /current operation/.test(b)));
  assert.ok(blockers.some(b => /running evaluation/.test(b)));
});
test('excerpt cap and test-name boundary use the actual supported thresholds', () => {
  const input = readyInput();
  input.recordings[0].regions = Array.from({ length: 200 }, () => region());
  input.name = 'a'.repeat(120);
  assert.deepEqual(evaluationBlockers(input), []);
  input.recordings[0].regions.push(region());
  input.name += 'a';
  const blockers = evaluationBlockers(input);
  assert.ok(blockers.some(b => /120 characters/.test(b)));
  assert.ok(blockers.some(b => /at most 200/.test(b)));
});
test('panels have no fixed count limit while names, deployments and unique IDs stay required', () => {
  const input = readyInput();
  input.config!.judges = Array.from({ length: 25 }, (_, i) => ({ id: randomUUID(), name: `Judge ${i}`, deployment: `deployment-${i}` }));
  assert.deepEqual(evaluationBlockers(input), []);
  input.config!.judges[1].id = input.config!.judges[0].id;
  assert.match(evaluationBlockers(input)[0], /judge/);
});
test('saved inputs use exact clip counts and validate roles and editable metadata without region confirmation', () => {
  const input = readyInput();
  input.recordings = [];
  input.savedClips = [{ ...clip(), include: true }];
  assert.deepEqual(evaluationBlockers(input), []);
  input.savedClips[0].voice = '';
  assert.match(evaluationBlockers(input)[0], /voice and language/);
  input.savedClips[0].voice = 'Candidate';
  input.savedClips[0].include = false;
  assert.match(evaluationBlockers(input)[0], /at least one saved/);
  input.savedClips = [{ ...clip({ role: 'agent' }), include: true }];
  input.scope = 'both';
  assert.match(evaluationBlockers(input)[0], /each selected role/);
  input.savedClips.push({ ...clip({ role: 'customer' }), include: true });
  assert.deepEqual(evaluationBlockers(input), []);
  input.savedClips.push({ ...clip({ role: 'agent' }), include: true });
  assert.match(evaluationBlockers(input)[0], /overlap/);
});
