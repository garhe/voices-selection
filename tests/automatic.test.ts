import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { automaticRegions } from '../src/audio.js';
import { evaluationBlockers, inputCount } from '../src/readiness.js';
import { eligibleScore, normalizeAssessment, summarize, type Assessment, type Clip, type Profile } from '../shared/domain.js';
import { ASSESSMENT_FUNCTION, assessmentTool, instructions, judgeAudio } from '../server/realtime.js';
import { assessment, clip, job, profile } from './fixtures.js';

const automatic: Profile = { ...profile, scope: 'both', speakerMode: 'automatic' };
function attributed(role: Clip['role'], status: 'identified' | 'not_present' | 'uncertain' = 'identified', value = 4): Assessment {
  const result = assessment(value);
  result.speakerAttribution = { role, status, evidence: status === 'identified' ? 'The speaker offers service and explains the next action.' : 'Role cannot be scored in this window.' };
  return normalizeAssessment(result, automatic, role);
}
test('automatic windows cover the entire file for each requested role without user timestamps', () => {
  for (const duration of [0.5, 120, 120.01, 241, 601.2]) {
    const regions = automaticRegions(duration, 'both');
    assert.equal(regions.length, Math.ceil(duration / 120) * 2);
    for (const role of ['agent', 'customer']) {
      const windows = regions.filter(r => r.role === role);
      assert.equal(windows[0].start, 0);
      assert.equal(windows.at(-1)!.end, duration);
      for (let i = 0; i < windows.length; i++) {
        assert.ok(windows[i].end - windows[i].start <= 120);
        assert.ok(windows[i].end - windows[i].start >= 0.5);
        assert.equal(windows[i].confirmed, false, 'Do not manufacture a human confirmation.');
        if (i) assert.equal(windows[i].start, windows[i - 1].end);
      }
    }
  }
  for (const duration of [0, 0.49, NaN, Infinity]) assert.throws(() => automaticRegions(duration, 'agent'));
});
test('automatic readiness never requires per-file review but still requires credentials, a panel and consent', () => {
  const input: Parameters<typeof evaluationBlockers>[0] = {
    name: 'Automatic conversation test', profile: automatic, speakerMode: 'automatic', scope: 'both', consent: true, busy: false, running: false,
    config: { configured: true, judges: [{ id: crypto.randomUUID(), name: 'Judge', deployment: 'test' }] },
    recordings: [{ include: true, regions: [] }, { include: true, regions: [] }],
  };
  assert.deepEqual(evaluationBlockers(input), []);
  assert.equal(inputCount(input.recordings, 'both', 'automatic'), 4);
  input.consent = false; input.config!.configured = false; input.config!.judges[0].deployment = '';
  assert.equal(evaluationBlockers(input).length, 3);
  assert.equal(evaluationBlockers(input).some(b => /Confirm speaker/.test(b)), false);
});
test('automatic input counts include every window and both roles for the 200-input cap', () => {
  const recordings = [{ include: true, regions: [], duration: 120.1 }];
  assert.equal(inputCount(recordings, 'both', 'automatic'), 4);
  const blockers = evaluationBlockers({
    name: 'Large run', profile: automatic, scope: 'both', speakerMode: 'automatic', consent: true, busy: false, running: false,
    config: { configured: true, judges: [{ id: crypto.randomUUID(), name: 'Judge', deployment: 'test' }] },
    recordings: Array.from({ length: 51 }, () => recordings[0]),
  });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /at most 200/);
});
test('automatic assessments require matching role evidence and never score ambiguous or absent targets', () => {
  assert.throws(() => normalizeAssessment(assessment(), automatic, 'agent'), /requires attribution/);
  assert.throws(() => normalizeAssessment(attributed('customer'), automatic, 'agent'), /requires attribution/);
  for (const status of ['uncertain', 'not_present'] as const) {
    const result = attributed('agent', status);
    assert.equal(result.assessable, false);
    assert.ok(Object.values(result.scores).every(s => s === null));
    assert.equal(eligibleScore(result, automatic), null);
  }
  assert.equal(eligibleScore(attributed('agent'), automatic), 4);
});
test('unanimously absent windows are counted and skipped; ambiguous or disputed windows prevent ranking', () => {
  const clips = [clip({ role: 'agent' }), clip({ role: 'agent', start: 1, end: 2 })];
  const value = job(clips);
  value.profile = automatic;
  for (const r of value.results) r.assessment = attributed('agent', r.clipId === clips[0].id ? 'identified' : 'not_present');
  let summary = summarize(value)[0];
  assert.equal(summary.score, 4); assert.equal(summary.absentWindows, 1);
  value.results[2].assessment = attributed('agent', 'uncertain');
  assert.equal(summarize(value)[0].score, null);
  value.results[2].assessment = attributed('agent');
  assert.equal(summarize(value)[0].score, null, 'Identified/not-present disagreement is not safe to skip.');
  for (const r of value.results) r.assessment = attributed('agent', 'not_present');
  summary = summarize(value)[0];
  assert.equal(summary.score, null); assert.equal(summary.eligibleFiles, 0); assert.equal(summary.absentWindows, 2);
  assert.equal(JSON.stringify(summary).includes('NaN'), false);
  value.results[0].assessment!.languageSupported = false;
  assert.equal(summarize(value)[0].absentWindows, 1, 'Unsupported language is not evidence that a role is absent.');
});
test('agent and customer assessments remain separate when they share the same conversation window', () => {
  const value = job([clip({ role: 'agent' }), clip({ role: 'customer' })]);
  value.profile = automatic;
  for (const r of value.results) {
    const role = value.clips.find(c => c.id === r.clipId)!.role;
    r.assessment = attributed(role, 'identified', role === 'agent' ? 5 : 2);
  }
  const summaries = summarize(value);
  assert.equal(summaries.find(s => s.role === 'agent')!.score, 5);
  assert.equal(summaries.find(s => s.role === 'customer')!.score, 2);
});
test('the listening rubric uses content, forbids first-speaker assumptions and does not claim diarization', () => {
  const prompt = instructions(automatic, 'customer');
  assert.match(prompt, /Requested role: customer/);
  assert.match(prompt, /conversational CONTENT/);
  assert.match(prompt, /Do NOT assume first speaker=agent/);
  assert.match(prompt, /not timestamp diarization or source separation/);
  assert.match(prompt, /Do not transcribe/);
});
test('Realtime receives the requested role and validates its attribution for the full conversation input', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const received: { role: Clip['role']; bytes: number }[] = [];
  server.on('connection', ws => {
    let role: Clip['role'] = 'agent', bytes = 0;
    ws.send(JSON.stringify({ type: 'session.created' }));
    ws.on('message', data => {
      const event = JSON.parse(data.toString());
      if (event.type === 'session.update') {
        role = event.session.instructions.includes('Requested role: customer') ? 'customer' : 'agent';
        assert.equal(event.session.audio.input.transcription, null);
        assert.deepEqual(event.session.tools, [assessmentTool(automatic, role)]);
        assert.deepEqual(event.session.tool_choice, { type: 'function', name: ASSESSMENT_FUNCTION });
        ws.send(JSON.stringify({ type: 'session.updated' }));
      } else if (event.type === 'input_audio_buffer.append') bytes += Buffer.from(event.audio, 'base64').length;
      else if (event.type === 'input_audio_buffer.commit') {
        received.push({ role, bytes }); ws.send(JSON.stringify({ type: 'input_audio_buffer.committed' }));
      } else if (event.type === 'response.create') {
        assert.deepEqual(event.response.tool_choice, { type: 'function', name: ASSESSMENT_FUNCTION });
        ws.send(JSON.stringify({
          type: 'response.done', response: { status: 'completed', output: [{
            type: 'function_call', name: ASSESSMENT_FUNCTION, arguments: JSON.stringify(attributed(role)),
          }] },
        }));
      }
    });
  });
  try {
    for (const role of ['agent', 'customer'] as const) {
      const result = await judgeAudio({
        endpoint: 'https://example.openai.azure.com', key: 'local-test-only',
        judge: { id: crypto.randomUUID(), name: 'Test', deployment: 'test' },
        profile: automatic, role, pcm: Buffer.alloc(48000), signal: new AbortController().signal,
        connect: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
      });
      assert.equal(result.assessment.speakerAttribution!.role, role);
    }
    assert.deepEqual(received, [{ role: 'agent', bytes: 48000 }, { role: 'customer', bytes: 48000 }]);
  } finally {
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
