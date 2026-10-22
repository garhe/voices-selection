import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { profile, assessment, clip, job } from './fixtures.js';
import { RUBRIC_VERSION, type AudioDiagnostics, type Job } from '../shared/domain.js';
import { JudgeAudioError } from '../server/realtime.js';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';

test('audio uploads accept maximum-length PCM and reject malformed base64 without overflowing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-upload-'));
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const { app, errors, store } = await createApp({ dataDir: root, port: address.port });
  app.use(errors); server.on('request', app);
  const url = `http://127.0.0.1:${address.port}/api/clips`;
  const upload = (pcm: string, end: number) => {
    const input = clip({ end });
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip: input, pcm }),
    });
  };
  try {
    const pcm = randomBytes(120 * 24000 * 2);
    const response = await upload(pcm.toString('base64'), 120);
    const saved = await response.json();
    assert.equal(response.status, 201, JSON.stringify(saved));
    assert.deepEqual(await store.pcm(saved.id), pcm);
    for (const bytes of [24000, 24002, 24004]) {
      const small = randomBytes(bytes);
      assert.equal((await upload(small.toString('base64'), bytes / 48000)).status, 201);
    }
    for (const malformed of ['bad', 'AA=A', 'A===', 'AAAA=', 'AA==AAAA', 'AAAA\n', '____', `${pcm.toString('base64').slice(0, -1)}!`]) {
      assert.equal((await upload(malformed, 120)).status, 400);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('evaluation language defaults and market targets reach every judge and role in both stages and speaker modes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-language-market-'));
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const calls: { language: string; targetMarket?: string; judge: string; role?: string }[] = [];
  const { app, errors, store } = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    deployments: 'first,second',
    evaluate: async options => {
      calls.push({ language: options.profile.language, targetMarket: options.profile.targetMarket, judge: options.judge.deployment, role: options.role });
      const value = assessment();
      value.scores.accentFit = 4;
      if (options.profile.speakerMode === 'automatic') {
        assert.ok(options.role);
        value.speakerAttribution = { role: options.role, status: 'identified', evidence: 'Content identifies this role.' };
      }
      return { assessment: value, responseFormat: 'function_call' };
    },
  });
  app.use(errors); server.on('request', app);
  const url = `http://127.0.0.1:${address.port}`;
  const create = (body: unknown) => fetch(`${url}/api/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const clips = [clip({ role: 'agent' }), clip({ role: 'customer' })];
    for (const input of clips) await store.saveClip(input, Buffer.alloc(48000));
    const targetMarket = 'UK customers; British English, regional variation welcome.';
    const base = {
      name: 'Market and language test', profile: { ...profile, scope: 'both', language: ' British English ', targetMarket },
      clipIds: clips.map(c => c.id), consent: true,
    };
    assert.equal((await create({ ...base, profile: { ...base.profile, language: ' ' } })).status, 400);
    assert.equal((await create({ ...base, profile: { ...base.profile, targetMarket: 'x'.repeat(501) } })).status, 400);
    assert.equal(calls.length, 0);
    for (const stage of ['audition', 'tts'] as const) for (const speakerMode of ['manual', 'automatic'] as const) {
      const offset = calls.length;
      const response = await create({
        ...base, profile: { ...base.profile, stage, speakerMode },
        clipOverrides: speakerMode === 'automatic'
          ? [{ id: clips[1].id, voice: clips[1].voice, language: 'Welsh English' }]
          : undefined,
      });
      assert.equal(response.status, 201);
      const created = await response.json() as Job;
      let done = created;
      for (let n = 0; n < 100 && done.status === 'running'; n++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        done = await (await fetch(`${url}/api/jobs/${created.id}`)).json() as Job;
      }
      assert.equal(done.status, 'completed');
      assert.equal(done.rubric, RUBRIC_VERSION);
      assert.equal(done.profile.targetMarket, targetMarket);
      assert.equal(done.clips[0].language, 'British English');
      assert.equal(done.clips[1].language, speakerMode === 'automatic' ? 'Welsh English' : 'British English');
      const received = calls.slice(offset);
      assert.equal(received.length, 4);
      for (const call of received) {
        assert.equal(call.language, speakerMode === 'automatic' && call.role === 'customer' ? 'Welsh English' : 'British English');
        assert.equal(call.targetMarket, targetMarket);
      }
      for (const role of ['agent', 'customer'])
        assert.deepEqual(received.filter(c => c.role === role).map(c => c.judge).sort(), ['first', 'second']);
      assert.equal((await store.clip(clips[0].id)).language, 'auto', 'Job language resolution must not mutate source audio metadata.');
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('targeted audio retries preserve good verdicts and audit history, persist telemetry and require consent and saved audio', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-audio-retry-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const calls: string[] = [];
  let serviceFailure = false;
  const diagnostic = (): AudioDiagnostics => ({
    inputBytes: 48000, inputSha256: 'a'.repeat(64), recovery: 'not_needed',
    sessions: [{ uploadedBytes: 48000, committed: true, responses: [{
      inputAudioTokens: 10, inputTextTokens: 200, outputTokens: 100, outputTypes: ['function_call'], outcome: 'accepted',
    }] }],
  });
  const { app, errors, store } = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async options => {
      calls.push(options.judge.id);
      if (serviceFailure) {
        const d = diagnostic(); d.sessions[0].error = 'Credential test-only was rejected.';
        throw new JudgeAudioError('Credential test-only was rejected.', d);
      }
      return { assessment: assessment(), responseFormat: 'function_call', audioDiagnostics: diagnostic() };
    },
  });
  app.use(errors); server.on('request', app);
  const url = `http://127.0.0.1:${address.port}`;
  const post = (id: string, body: unknown) => fetch(`${url}/api/jobs/${id}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  async function wait(id: string): Promise<Job> {
    for (let n = 0; n < 100; n++) {
      const value = await (await fetch(`${url}/api/jobs/${id}`)).json() as Job;
      if (value.status !== 'running') return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for targeted audio retry.');
  }
  try {
    const original = job(undefined, [4, 4, 4, 4]);
    original.rubric = RUBRIC_VERSION;
    original.results[0].assessment!.assessable = false;
    original.results[0].assessment!.languageSupported = false;
    original.results[0].assessment!.limitations = ['No actual audio was presented for evaluation.'];
    original.results[2].assessment!.assessable = false;
    original.results[2].assessment!.limitations = ['Overlapping speech prevents reliable role attribution.'];
    original.results[3].status = 'failed'; original.results[3].error = 'Previous connection failure.';
    delete original.results[3].assessment;
    await store.saveClip(original.clips[0], Buffer.alloc(48000));
    await store.saveJob(original);
    assert.equal((await post(original.id, { consent: false, retryAudioIssues: true })).status, 400);
    await store.remove(path.join('clips', `${original.clips[0].id}.pcm`));
    assert.equal((await post(original.id, { consent: true, retryAudioIssues: true })).status, 409);
    assert.deepEqual(await store.read(path.join('jobs', `${original.id}.json`)), original);
    await store.saveClip(original.clips[0], Buffer.alloc(48000));
    assert.equal((await post(original.id, { consent: true, retryAudioIssues: true })).status, 200);
    const done = await wait(original.id);
    assert.deepEqual(calls, [original.results[0].judgeId]);
    assert.equal(done.results[0].assessment!.assessable, true);
    assert.equal(done.results[0].audioDiagnostics!.sessions[0].responses[0].inputAudioTokens, 10);
    assert.deepEqual(done.results[0].previousEvaluations![0].assessment, original.results[0].assessment);
    for (const i of [1, 2, 3]) assert.deepEqual(done.results[i], original.results[i]);
    assert.deepEqual(await store.read(path.join('jobs', `${original.id}.json`)), done);
    assert.equal((await post(original.id, { consent: true, retryAudioIssues: true })).status, 409);
    serviceFailure = true;
    assert.equal((await post(original.id, { consent: true })).status, 200);
    const failed = await wait(original.id);
    assert.deepEqual(calls, [original.results[0].judgeId, original.results[3].judgeId]);
    assert.equal(failed.results[3].status, 'failed');
    assert.equal(failed.results[3].assessment, undefined);
    assert.ok(failed.results[3].audioDiagnostics);
    assert.equal(failed.results[3].previousEvaluations![0].error, 'Previous connection failure.');
    assert.equal(JSON.stringify(failed).includes('test-only'), false);
    const legacy = { ...original, id: randomUUID(), rubric: 'audio-only-v2' };
    await store.saveJob(legacy);
    for (const retryAudioIssues of [false, true]) {
      const rejected = await post(legacy.id, { consent: true, retryAudioIssues });
      assert.equal(rejected.status, 409);
      assert.match((await rejected.json()).error, /rubric changed/);
    }
    assert.equal(calls.length, 2, 'Earlier-rubric verdicts must not be mixed with new criteria.');
    assert.deepEqual(await store.read(path.join('jobs', `${legacy.id}.json`)), legacy);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('API persists clips, judges and results; validates requests; retries only incomplete judges', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-test-'));
  let calls = 0;
  let failSecond = true;
  let hold: Promise<void> | undefined;
  let release = () => {};
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const { app, errors, store } = await createApp({
    dataDir: root, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    deployments: 'first,second', port: address.port,
    evaluate: async options => {
      await hold;
      calls++;
      if (options.judge.deployment === 'second' && failSecond) throw new Error('Simulated judge failure');
      const value = assessment(4);
      if (options.profile.speakerMode === 'automatic') {
        assert.ok(options.role);
        value.speakerAttribution = { role: options.role, status: 'identified', evidence: 'Content identifies the requested role.' };
      }
      return { assessment: value, model: 'fixture-model', responseFormat: 'json_text' };
    },
  });
  const saveJob = store.saveJob.bind(store);
  store.saveJob = async value => {
    if (value.status === 'completed') await new Promise(resolve => setTimeout(resolve, 40));
    return saveJob(value);
  };
  app.use(errors);
  server.on('request', app);
  const url = `http://127.0.0.1:${address.port}`;
  const request = async (route: string, body?: unknown, method = 'POST') => fetch(url + route, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function wait(id: string): Promise<Job> {
    for (let n = 0; n < 100; n++) {
      const value = await (await request(`/api/jobs/${id}`)).json() as Job;
      if (value.status !== 'running') return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for local test evaluation.');
  }
  try {
    const config = await (await request('/api/config')).json();
    assert.equal(config.configured, true); assert.equal(config.key, undefined);
    assert.equal(config.rubric, RUBRIC_VERSION);
    assert.equal(JSON.stringify(config).includes('test-only'), false);
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(url + '/api/config', { headers: { Host: 'evil.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(url + '/api/config', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/api/settings', { judges: [] }, 'PUT')).status, 400);
    const id = randomUUID();
    const clip = { id, voice: 'Candidate A', file: 'root/Candidate A/test.wav', role: 'speaker', start: 0, end: 1, channel: 'mix', language: 'auto' };
    assert.equal((await request('/api/clips', { clip, pcm: Buffer.alloc(48000).toString('base64') })).status, 201);
    assert.equal((await request('/api/clips', { clip: { ...clip, id: randomUUID() }, pcm: 'bad' })).status, 400);
    assert.equal((await request('/api/clips', { clip: { ...clip, id: randomUUID(), end: 10 }, pcm: Buffer.alloc(48000).toString('base64') })).status, 400);
    const input = { name: '  Auditions - round 1  ', profile, clipIds: [id], consent: true };
    assert.equal((await request('/api/jobs', { ...input, name: undefined })).status, 400);
    assert.equal((await request('/api/jobs', { ...input, name: '   ' })).status, 400);
    assert.equal((await request('/api/jobs', { ...input, name: 'a'.repeat(121) })).status, 400);
    assert.equal((await request('/api/jobs', { ...input, consent: false })).status, 400);
    assert.equal((await request('/api/jobs', { ...input, profile: { ...profile, scope: 'both' } })).status, 400);
    assert.equal((await request('/api/jobs', { ...input, clipIds: [id, id] })).status, 400);
    const response = await request('/api/jobs', input);
    assert.equal(response.status, 201);
    const created = await response.json() as Job;
    assert.equal(created.name, 'Auditions - round 1');
    assert.equal(created.rubric, RUBRIC_VERSION);
    const done = await wait(created.id);
    assert.equal(calls, 2);
    assert.equal(done.results.filter(r => r.status === 'completed').length, 1);
    assert.equal(done.results.find(r => r.status === 'completed')!.responseFormat, 'json_text');
    assert.equal(done.results.filter(r => r.status === 'failed').length, 1);
    assert.equal((await store.jobs())[0].name, 'Auditions - round 1');
    assert.equal((await (await request('/api/jobs')).json())[0].name, 'Auditions - round 1');
    const audio = await request(`/api/clips/${id}/audio`);
    assert.equal(audio.status, 200); assert.equal((await audio.arrayBuffer()).byteLength, 48044);
    failSecond = false;
    assert.equal((await request(`/api/jobs/${created.id}/resume`, { consent: true })).status, 200);
    const resumed = await wait(created.id);
    assert.equal(resumed.name, 'Auditions - round 1');
    assert.equal(resumed.results.filter(r => r.status === 'completed').length, 2);
    assert.equal(calls, 3);
    assert.equal((await request(`/api/jobs/${created.id}/resume`, { consent: true })).status, 409);
    const automaticIds: string[] = [];
    for (const role of ['agent', 'customer']) {
      const nextId = randomUUID(); automaticIds.push(nextId);
      assert.equal((await request('/api/clips', {
        clip: { ...clip, id: nextId, role }, pcm: Buffer.alloc(48000).toString('base64'),
      })).status, 201);
    }
    const automaticResponse = await request('/api/jobs', {
      name: 'Automatic roles', profile: { ...profile, scope: 'both', speakerMode: 'automatic' }, clipIds: automaticIds, consent: true,
    });
    assert.equal(automaticResponse.status, 201);
    const automaticJob = await wait((await automaticResponse.json() as Job).id);
    assert.equal(automaticJob.profile.speakerMode, 'automatic');
    assert.equal(automaticJob.results.length, 4);
    for (const r of automaticJob.results) {
      assert.equal(r.status, 'completed');
      assert.equal(r.responseFormat, 'json_text');
      assert.equal(r.assessment!.speakerAttribution!.role, automaticJob.clips.find(c => c.id === r.clipId)!.role);
    }
    const judges = Array.from({ length: 25 }, (_, i) => ({ id: randomUUID(), name: `Judge ${i}`, deployment: `deployment-${i}` }));
    assert.equal((await request('/api/settings', { judges }, 'PUT')).status, 200);
    const draft = await (await request(`/api/jobs/${created.id}/draft`)).json();
    assert.equal(draft.missing, 0);
    assert.deepEqual(draft.job, resumed);
    assert.deepEqual(draft.clips, resumed.clips);
    const copyInput = {
      name: 'Edited copy', profile: { ...profile, stage: 'tts', target: 'Warm delivery' }, clipIds: [id], consent: true,
      clipOverrides: [{ id, voice: 'Renamed voice', language: 'English' }],
    };
    assert.equal((await request('/api/jobs', { ...copyInput, clipOverrides: [{ ...copyInput.clipOverrides[0], id: randomUUID() }] })).status, 400);
    assert.equal((await request('/api/jobs', { ...copyInput, clipOverrides: [...copyInput.clipOverrides, ...copyInput.clipOverrides] })).status, 400);
    hold = new Promise<void>(resolve => { release = resolve; });
    const copiedResponse = await request('/api/jobs', copyInput);
    assert.equal(copiedResponse.status, 201);
    const copied = await copiedResponse.json() as Job;
    assert.notEqual(copied.id, created.id);
    assert.equal((await request(`/api/jobs/${copied.id}`, {}, 'DELETE')).status, 409);
    release(); hold = undefined;
    const copiedDone = await wait(copied.id);
    assert.equal(copiedDone.results.length, 25);
    assert.ok(copiedDone.results.every(r => r.status === 'completed'));
    assert.equal(copiedDone.clips[0].voice, 'Renamed voice');
    assert.equal(copiedDone.clips[0].language, 'English');
    assert.equal(copiedDone.profile.stage, 'tts');
    assert.deepEqual(await (await request(`/api/jobs/${created.id}`)).json(), resumed);
    assert.equal((await store.clip(id)).voice, 'Candidate A', 'Copy overrides never mutate source clip metadata.');
    const copiedDraft = await (await request(`/api/jobs/${copied.id}/draft`)).json();
    assert.equal(copiedDraft.clips[0].voice, 'Renamed voice');
    assert.equal((await request(`/api/jobs/${created.id}`, {}, 'DELETE')).status, 200);
    assert.equal((await request(`/api/jobs/${created.id}`)).status, 404);
    assert.equal((await request(`/api/jobs/${created.id}/draft`)).status, 404);
    assert.equal((await request(`/api/jobs/${created.id}/resume`, { consent: true })).status, 404);
    assert.equal((await request(`/api/jobs/${created.id}`, {}, 'DELETE')).status, 404);
    assert.equal((await request('/api/jobs/not-a-uuid', {}, 'DELETE')).status, 400);
    assert.ok(!(await store.jobs()).some(j => j.id === created.id));
    assert.equal((await request(`/api/clips/${id}/audio`)).status, 200, 'Shared audio survives history deletion.');
    assert.equal((await request(`/api/jobs/${copied.id}`)).status, 200);
    await store.remove(path.join('clips', `${id}.pcm`));
    const missingDraft = await (await request(`/api/jobs/${copied.id}/draft`)).json();
    assert.equal(missingDraft.missing, 1);
    assert.deepEqual(missingDraft.clips, []);
    const missingAudio = await request('/api/jobs', copyInput);
    assert.equal(missingAudio.status, 400);
    assert.match((await missingAudio.json()).error, /audio is unavailable/);
  } finally {
    release();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
test('restart marks in-flight work interrupted but preserves completed assessments', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-restart-'));
  try {
    const first = await createApp({ dataDir: root });
    const value = job();
    value.status = 'running'; value.results[1].status = 'running';
    await first.store.saveJob(value);
    const second = await createApp({ dataDir: root });
    const restored = (await second.store.jobs())[0];
    assert.equal(restored.status, 'interrupted');
    assert.equal(restored.results[0].status, 'completed');
    assert.equal(restored.results[1].status, 'interrupted');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a fatal save failure aborts and drains parallel judges before releasing the run, preserving completed results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-save-failure-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let secondStarted!: () => void, aborted!: () => void, releaseCleanup!: () => void;
  const secondReady = new Promise<void>(resolve => { secondStarted = resolve; });
  const abortReceived = new Promise<void>(resolve => { aborted = resolve; });
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
  let settled = false, failedSave = false;
  const { app, errors, store, cancelActive } = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    deployments: 'first,second',
    evaluate: async options => {
      if (options.judge.deployment === 'first') {
        await secondReady;
        return { assessment: assessment(4), model: 'local-fixture' };
      }
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted();
          void cleanup.then(() => { settled = true; reject(new Error('Local judge aborted after persistence failure.')); });
        }, { once: true });
        secondStarted();
      });
    },
  });
  const saveJob = store.saveJob.bind(store);
  store.saveJob = async value => {
    if (!failedSave && value.results.some(r => r.status === 'completed')) {
      failedSave = true;
      throw Object.assign(new Error('Simulated persistent rename lock'), { code: 'EPERM' });
    }
    if (value.status === 'interrupted') await new Promise(resolve => setTimeout(resolve, 40));
    return saveJob(value);
  };
  app.use(errors); server.on('request', app);
  const url = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const id = randomUUID();
    assert.equal((await post('/api/clips', {
      clip: { id, voice: 'Fixture', file: 'fixture.wav', role: 'speaker', start: 0, end: 1, channel: 'mix', language: 'auto' },
      pcm: Buffer.alloc(48000).toString('base64'),
    })).status, 201);
    const input = { name: 'Persistence failure test', profile, clipIds: [id], consent: true };
    const started = await (await post('/api/jobs', input)).json() as Job;
    for (let n = 0; !failedSave && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(failedSave, true);
    await abortReceived;
    assert.equal(settled, false);
    assert.equal((await post('/api/jobs', input)).status, 409, 'Do not release the run while another judge is still cleaning up.');
    releaseCleanup();
    let done = started;
    for (let n = 0; n < 100; n++) {
      done = await (await fetch(url + `/api/jobs/${started.id}`)).json() as Job;
      if (done.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(settled, true);
    assert.equal(done.status, 'interrupted');
    assert.equal(done.results.filter(r => r.status === 'completed').length, 1);
    assert.deepEqual((await store.jobs())[0], done, 'Interrupted status is not exposed before its final save settles.');
  } finally {
    releaseCleanup(); cancelActive();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation aborts active judges, skips pending clips, and rejects concurrent starts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-workbench-cancel-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let calls = 0;
  const { app, errors, cancelActive } = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: options => new Promise((_resolve, reject) => {
      calls++;
      const cancel = () => reject(new Error('Cancelled in test.'));
      if (options.signal.aborted) cancel();
      else options.signal.addEventListener('abort', cancel, { once: true });
    }),
  });
  app.use(errors); server.on('request', app);
  const url = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID(); ids.push(id);
      assert.equal((await post('/api/clips', {
        clip: { id, voice: 'Example', file: `${i}.wav`, role: 'speaker', start: 0, end: 1, channel: 'mix', language: 'auto' },
        pcm: Buffer.alloc(48000).toString('base64'),
      })).status, 201);
    }
    const input = { name: 'Cancellation test', profile, clipIds: ids, consent: true };
    const started = await (await post('/api/jobs', input)).json() as Job;
    for (let n = 0; calls < 2 && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 2);
    assert.equal((await post('/api/jobs', input)).status, 409);
    assert.equal((await post(`/api/jobs/${started.id}/cancel`, {})).status, 200);
    let completed: Job = started;
    for (let n = 0; n < 100; n++) {
      completed = await (await fetch(url + `/api/jobs/${started.id}`)).json() as Job;
      if (completed.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(completed.status, 'cancelled');
    assert.ok(completed.results.every(r => r.status === 'cancelled'));
    assert.equal(calls, 2, 'The second recording must not be sent to any judge.');
  } finally {
    cancelActive();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
