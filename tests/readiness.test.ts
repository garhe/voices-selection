import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyLanguageHint, evaluationBlockers, recordingReviewed, withLanguageAccent, withTestNameLanguage, DEFAULT_TEST_GUIDE } from '../src/readiness.js';
import { activeDimensions, profileSchema } from '../shared/domain.js';
import type { Region } from '../src/audio.js';
import { clip, profile as baseProfile } from './fixtures.js';

const profile = { ...baseProfile, target: 'Warm, calm and conversational.' };

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
