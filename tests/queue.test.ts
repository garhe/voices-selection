import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { assessment, clip, profile, job as fixtureJob } from './fixtures.js';
import type { BulkTestResult } from '../shared/history.js';
import { RUBRIC_VERSION, DEFAULT_RUBRIC, type Job, type TestQueueState } from '../shared/domain.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestQueue } from '../src/TestQueue.js';

async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  for (let n = 0; n < 200; n++) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the test queue.');
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('targeted retries join the FIFO queue, preserve other judgments, and allow one pending retry per test', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-queued-retry-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const firstGate = gate(), retryGate = gate();
  const calls: string[] = [];
  const activeTargets = new Map<string, number>();
  let maximumTests = 0;
  const backend = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async input => {
      const target = input.profile.target;
      calls.push(target);
      activeTargets.set(target, (activeTargets.get(target) ?? 0) + 1);
      maximumTests = Math.max(maximumTests, activeTargets.size);
      try {
        if (target === 'Active') await firstGate.promise;
        if (target === 'Retry A') await retryGate.promise;
        const result = assessment(); result.scores.contextFit = 4;
        return { assessment: result, responseFormat: 'function_call' };
      } finally {
        const count = activeTargets.get(target)! - 1;
        if (count) activeTargets.set(target, count); else activeTargets.delete(target);
      }
    },
  });
  backend.app.use(backend.errors); server.on('request', backend.app);
  const url = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const readJob = async (id: string) => await (await fetch(`${url}/api/jobs/${id}`)).json() as Job;
  const state = async () => await (await fetch(url + '/api/queue')).json() as TestQueueState;
  const clips = [clip({ file: 'retry/first.wav' }), clip({ file: 'retry/other.wav' })];
  for (const saved of clips) await backend.store.saveClip(saved, Buffer.alloc(48000));
  const source = (name: string) => {
    const value = fixtureJob(clips, [4, 4]);
    value.rubric = RUBRIC_VERSION; value.name = name; value.profile = { ...profile, target: name };
    for (const result of value.results) result.assessment!.scores.contextFit = 4;
    value.results[0].assessment!.assessable = false;
    return value;
  };
  const a = source('Retry A'), b = source('Retry B');
  a.results[2].status = 'failed'; a.results[2].error = 'Unselected service failure.'; delete a.results[2].assessment;
  b.results[2].assessment!.scores.naturalness = null;
  await backend.store.saveJob(a); await backend.store.saveJob(b);
  const addNormal = async (name: string) => {
    const response = await post('/api/jobs', {
      name, profile: { ...profile, target: name }, clipIds: [clips[0].id],
      judges: [a.judges[0]], consent: true, enqueue: true,
    });
    assert.equal(response.status, 201);
    return await response.json() as Job;
  };
  try {
    await backend.store.remove(path.join('clips', `${clips[0].id}.pcm`));
    const missing = await post(`/api/jobs/${a.id}/retry`, { consent: true, retryUnassessed: true, file: clips[0].file });
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /Saved audio is unavailable/);
    assert.deepEqual(await readJob(a.id), a);
    await backend.store.saveClip(clips[0], Buffer.alloc(48000));
    const first = await addNormal('Active');
    await until(state, value => value.active?.id === first.id);
    const responses = await Promise.all([0, 1].map(() => post(`/api/jobs/${a.id}/retry`, {
      consent: true, retryUnassessed: true, singleSpeakerFallback: true, file: clips[0].file,
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]);
    const normal = await addNormal('Normal');
    assert.equal((await post(`/api/jobs/${b.id}/retry`, { consent: true })).status, 202,
      'Completed but unassessable/partial judgments are retryable, even with no failed task status.');
    const waiting = (await state()).waiting;
    assert.deepEqual(waiting.map(value => value.id), [a.id, normal.id, b.id]);
    assert.equal(waiting[0].retry, true); assert.equal(waiting[2].retry, true);
    const queued = await readJob(a.id);
    assert.equal(queued.status, 'queued');
    assert.equal(queued.profile.singleSpeakerFallback, true);
    assert.deepEqual(queued.retrySelection, [{ clipId: clips[0].id, judgeId: a.judges[0].id }]);
    assert.deepEqual(queued.results[0].previousEvaluations![0].assessment, a.results[0].assessment);
    for (const index of [1, 2, 3]) assert.deepEqual(queued.results[index], a.results[index]);
    firstGate.release();
    await until(state, value => value.active?.id === a.id);
    assert.equal((await post(`/api/jobs/${a.id}/retry`, { consent: true })).status, 409);
    assert.deepEqual(calls, ['Active', 'Retry A']);
    retryGate.release();
    await until(state, value => !value.active && !value.waiting.length);
    assert.deepEqual(calls, ['Active', 'Retry A', 'Normal', 'Retry B', 'Retry B']);
    assert.equal(maximumTests, 1);
    const done = await readJob(a.id);
    for (const index of [1, 2, 3]) assert.deepEqual(done.results[index], a.results[index]);
    assert.equal(done.retrySelection, undefined);
    assert.equal((await post(`/api/jobs/${a.id}/retry`, { consent: true })).status, 202);
    await until(state, value => !value.active && !value.waiting.length);
    assert.deepEqual(calls.slice(-1), ['Retry A']);
    const final = await readJob(a.id);
    assert.equal(final.results[2].status, 'completed');
    assert.equal(final.results[2].previousEvaluations![0].error, a.results[2].error);
    assert.equal((await post(`/api/jobs/${a.id}/retry`, { consent: true })).status, 409,
      'A fully assessable test has no work to retry.');
  } finally {
    firstGate.release(); retryGate.release(); backend.cancelActive();
    server.close(); await once(server, 'close');
    await rm(root, { recursive: true, force: true });
  }
});

test('queued retry selections survive cancellation failures and restart without changing unselected results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-retry-restart-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let calls = 0;
  const options = {
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async () => { calls++; return { assessment: assessment(), responseFormat: 'function_call' as const }; },
  };
  let backend = await createApp(options);
  backend.app.use(backend.errors);
  server.on('request', (req, res) => backend.app(req, res));
  const url = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const state = async () => await (await fetch(url + '/api/queue')).json() as TestQueueState;
  const readJob = async () => await backend.store.read<Job>(path.join('jobs', `${original.id}.json`));
  const clips = [clip({ file: 'selected.wav' }), clip({ file: 'untouched.wav' })];
  const original = fixtureJob(clips, [4, 4]); original.rubric = RUBRIC_VERSION;
  original.results[0].assessment!.assessable = false;
  original.results[2].status = 'failed'; original.results[2].error = 'Unselected failure.'; delete original.results[2].assessment;
  for (const saved of clips) await backend.store.saveClip(saved, Buffer.alloc(48000));
  await backend.store.saveJob(original);
  const retry = () => post(`/api/jobs/${original.id}/retry`, { consent: true, retryUnassessed: true, file: clips[0].file });
  try {
    await post('/api/queue/pause', {});
    assert.equal((await retry()).status, 202);
    const queued = await readJob();
    const save = backend.store.saveJob.bind(backend.store);
    let fail = true;
    backend.store.saveJob = async value => {
      if (value.status === 'cancelled' && fail) { fail = false; throw new Error('Synthetic retry cancellation persistence failure'); }
      return save(value);
    };
    assert.equal((await post(`/api/jobs/${original.id}/cancel`, {})).status, 400);
    assert.deepEqual(await readJob(), queued);
    assert.equal((await state()).waiting.length, 1);
    assert.equal((await post(`/api/jobs/${original.id}/cancel`, {})).status, 200);
    const cancelled = await readJob();
    assert.equal(cancelled.results[0].status, 'cancelled');
    for (const index of [1, 2, 3]) assert.deepEqual(cancelled.results[index], original.results[index]);
    assert.equal((await retry()).status, 202);
    backend.cancelActive();
    backend = await createApp(options); backend.app.use(backend.errors);
    const restarted = await state();
    assert.equal(restarted.paused, true);
    assert.equal(restarted.waiting[0].retry, true);
    assert.equal(calls, 0);
    await post('/api/queue/start', { consent: true });
    await until(state, value => !value.active && !value.waiting.length);
    const done = await readJob();
    assert.equal(calls, 1, 'Only the persisted selected judgment runs after restart.');
    for (const index of [1, 2, 3]) assert.deepEqual(done.results[index], original.results[index]);
    assert.equal(done.results[0].previousEvaluations!.length, 2);
  } finally {
    backend.cancelActive(); server.close(); await once(server, 'close');
    await rm(root, { recursive: true, force: true });
  }
});

test('queued tests run FIFO with saved inputs, continue after failures, and support pause and cancellation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-queue-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const calls: string[] = [];
  const firstGate = gate();
  let inFlight = 0, maximum = 0;
  const backend = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async input => {
      inFlight++; maximum = Math.max(maximum, inFlight); calls.push(input.profile.target);
      try {
        if (input.profile.target === 'First') await firstGate.promise;
        if (input.profile.target === 'Fails') throw new Error('Synthetic judge failure');
        return { assessment: assessment(), responseFormat: 'function_call' };
      } finally { inFlight--; }
    },
  });
  server.on('request', backend.app); backend.app.use(backend.errors);
  const url = `http://127.0.0.1:${address.port}`;
  const request = (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(url + route, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const readJob = async (id: string) => await (await request(`/api/jobs/${id}`)).json() as Job;
  const state = async () => await (await request('/api/queue')).json() as TestQueueState;
  const saved = clip(); const judge = { id: randomUUID(), name: 'Snapshot judge', deployment: 'snapshot-deployment' };
  await backend.store.saveClip(saved, Buffer.alloc(48000));
  const input = (target: string) => ({
    name: `${target} en-GB Male`, profile: { ...profile, target }, clipIds: [saved.id], consent: true,
    enqueue: true, judges: [judge],
  });
  const add = async (target: string) => {
    const response = await request('/api/jobs', input(target));
    assert.equal(response.status, 201); return await response.json() as Job;
  };
  try {
    assert.equal((await request('/api/jobs', { ...input('No consent'), consent: false })).status, 400);
    assert.equal((await request('/api/jobs', { ...input('Duplicate judges'), judges: [judge, judge] })).status, 400);
    const first = await add('First');
    await until(state, value => value.active?.id === first.id);
    const failing = await add('Fails');
    const final = await add('Final');
    const cancelled = await add('Cancelled');
    assert.deepEqual((await state()).waiting.map(job => job.id), [failing.id, final.id, cancelled.id]);
    assert.equal((await request('/api/jobs', { ...input('Cannot jump'), enqueue: false })).status, 409);
    assert.equal((await request(`/api/jobs/${final.id}/resume`, { consent: true })).status, 409);
    assert.equal((await request(`/api/jobs/${final.id}`, {}, 'DELETE')).status, 409);
    assert.equal((await request(`/api/jobs/${final.id}`, { name: 'Changed', voiceLabels: [] }, 'PATCH')).status, 409);
    assert.equal((await request('/api/queue/pause', {})).status, 200);
    assert.equal((await request(`/api/jobs/${cancelled.id}/cancel`, {})).status, 200);
    assert.equal((await readJob(cancelled.id)).status, 'cancelled');
    firstGate.release();
    await until(() => readJob(first.id), value => value.status === 'completed');
    assert.deepEqual(calls, ['First']);
    assert.equal((await readJob(final.id)).status, 'queued');
    const persisted = await backend.store.read<Job>(path.join('jobs', `${final.id}.json`));
    assert.deepEqual(persisted.judges, [judge]); assert.equal(persisted.profile.target, 'Final');
    await request('/api/settings', { judges: [{ ...judge, id: randomUUID(), name: 'Changed panel' }] }, 'PUT');
    assert.equal((await request('/api/queue/start', { consent: false })).status, 400);
    await request('/api/queue/start', { consent: true });
    await until(() => readJob(final.id), value => value.status === 'completed');
    assert.deepEqual(calls, ['First', 'Fails', 'Final']);
    assert.equal(maximum, 1);
    assert.equal((await readJob(failing.id)).results[0].status, 'failed');
    assert.match((await readJob(failing.id)).results[0].error!, /Synthetic judge failure/);
    assert.deepEqual((await readJob(final.id)).judges, [judge]);
    assert.deepEqual((await state()).waiting, []);
    assert.equal((await backend.store.clip(saved.id)).voice, saved.voice);
  } finally {
    firstGate.release(); backend.cancelActive();
    server.close(); await once(server, 'close');
    await rm(root, { recursive: true, force: true });
  }
});

test('saved queue survives a restart without sending audio until explicitly started', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-queue-restart-'));
  let calls = 0;
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let backend = await createApp({ dataDir: root, port: address.port });
  const saved = clip();
  await backend.store.saveClip(saved, Buffer.alloc(48000));
  const judge = { id: randomUUID(), name: 'Saved judge', deployment: 'saved-deployment' };
  const queued = (name: string, queueOrder: number): Job => ({
    id: randomUUID(), name, createdAt: '2026-10-23T10:00:00Z', status: 'queued', queueOrder,
    profile: { ...profile, target: name }, judges: [judge], clips: [saved], rubric: RUBRIC_VERSION,
    results: [{ clipId: saved.id, judgeId: judge.id, status: 'pending' }],
  });
  const second = queued('Second', 2), first = queued('First', 1), obsolete = queued('Old rubric', 0);
  obsolete.rubric = 'old-rubric';
  await backend.store.saveJob(second); await backend.store.saveJob(first); await backend.store.saveJob(obsolete);
  const interrupted = { ...queued('Previously running', 3), status: 'running' as const };
  await backend.store.saveJob(interrupted);
  backend = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async () => { calls++; return { assessment: assessment(), responseFormat: 'function_call' }; },
  });
  server.on('request', backend.app); backend.app.use(backend.errors);
  const url = `http://127.0.0.1:${address.port}`;
  const read = async (route: string) => await (await fetch(url + route)).json();
  try {
    const state = await read('/api/queue') as TestQueueState;
    assert.equal(state.paused, true); assert.equal(calls, 0);
    assert.deepEqual(state.waiting.map(job => job.id), [obsolete.id, first.id, second.id]);
    assert.equal((await read(`/api/jobs/${interrupted.id}`)).status, 'interrupted');
    await fetch(url + '/api/queue/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
    await until(() => read(`/api/jobs/${second.id}`) as Promise<Job>, value => value.status === 'completed');
    assert.equal(calls, 2);
    assert.equal((await read(`/api/jobs/${obsolete.id}`)).status, 'interrupted');
    assert.match((await read(`/api/jobs/${obsolete.id}`)).results[0].error, /rubric changed/);
    assert.equal((await read(`/api/jobs/${first.id}`)).status, 'completed');
  } finally {
    backend.cancelActive(); server.close(); await once(server, 'close');
    await rm(root, { recursive: true, force: true });
  }
});

test('queue panel stays compact and exposes ordered waiting tests, cancellation and pause/start controls', () => {
  const noop = () => {};
  const render = (state: TestQueueState) => renderToStaticMarkup(createElement(TestQueue, {
    state, busy: false, onPause: noop, onStart: noop, onCancel: noop,
  }));
  assert.equal(render({ paused: false, waiting: [] }), '');
  const html = render({ paused: false, active: { id: 'active', name: 'Current' }, waiting: [{ id: 'next', name: 'Next' }] });
  assert.match(html, /Running: Current/); assert.match(html, /Pause queue/);
  assert.match(html, /Cancel queued test Next/); assert.match(html, /<details>/);
  assert.match(html, /<ol><li><div class="test-queue-row"><span title="Next">Next<\/span>/);
  assert.match(render({ paused: true, waiting: [{ id: 'next', name: 'Next' }], error: 'Connection unavailable' }), /Start queue/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.test-queue-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;align-items:center;gap:12px\}/);
  assert.match(css, /\.test-queue-row>span\{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis\}/);
  assert.match(css, /\.test-queue-row>button\{justify-self:end\}/);
});

test('concurrent queue admissions persist before execution and a dispatch save failure pauses without losing tests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-queue-persistence-'));
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const calls: string[] = [];
  const backend = await createApp({
    dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async input => { calls.push(input.profile.target); return { assessment: assessment(), responseFormat: 'function_call' }; },
  });

  test('bulk redo snapshots saved settings into new queued jobs, preserves originals, and reports per-test failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voice-bulk-tests-'));
    const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    let calls = 0;
    const backend = await createApp({
      dataDir: root, port: address.port, endpoint: 'https://example.openai.azure.com', key: 'test-only',
      evaluate: async () => { calls++; return { assessment: assessment(), responseFormat: 'function_call' }; },
    });
    backend.app.use(backend.errors); server.on('request', backend.app);
    const url = `http://127.0.0.1:${address.port}`;
    const post = (route: string, body: unknown) => fetch(url + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const saved = clip({ language: 'ko-KR' });
    await backend.store.saveClip(saved, Buffer.alloc(48000));
    const source = fixtureJob([saved], [4]);
    source.name = 'ko-KR Female VTS';
    source.profile = { ...profile, target: 'Original detailed guide', language: 'ko-KR', targetMarket: 'ko-KR' };
    source.voiceLabels = [{ voice: saved.voice, gender: 'Female' }];
    await backend.store.saveJob(source);
    const missing = fixtureJob([clip()], [3]);
    missing.profile = { ...profile, target: 'Guide for missing audio' };
    await backend.store.saveJob(missing);
    const original = JSON.stringify(source);
    try {
      await post('/api/queue/pause', {});
      const queued = await (await post('/api/jobs', {
        name: 'Already waiting', profile: source.profile, clipIds: [saved.id], judges: source.judges, consent: true, enqueue: true,
      })).json() as Job;
      const missingId = randomUUID();
      const ids = [source.id, missing.id, queued.id, missingId];
      assert.equal((await post('/api/jobs/bulk', { action: 'redo', ids })).status, 400);
      assert.equal((await post('/api/jobs/bulk', { action: 'redo', ids, consent: false })).status, 400);
      assert.equal((await post('/api/jobs/bulk', { action: 'delete', ids: [source.id, source.id] })).status, 400);
      assert.equal((await post('/api/jobs/bulk', { action: 'delete', ids: ['not-an-id'] })).status, 400);
      const result = await (await post('/api/jobs/bulk', { action: 'redo', ids, consent: true })).json() as BulkTestResult;
      assert.equal(result.succeeded.length, 1); assert.equal(result.failed.length, 3);
      assert.equal(result.succeeded[0].id, source.id);
      assert.match(result.failed.find(item => item.id === missing.id)!.error, /Saved audio is unavailable/);
      assert.match(result.failed.find(item => item.id === queued.id)!.error, /queued/);
      const copy = await backend.store.read<Job>(path.join('jobs', `${result.succeeded[0].newId}.json`));
      assert.notEqual(copy.id, source.id); assert.equal(copy.name, source.name); assert.equal(copy.status, 'queued');
      assert.equal(copy.rubric, RUBRIC_VERSION);
      assert.deepEqual(copy.profile, { ...source.profile, rubric: DEFAULT_RUBRIC }); assert.deepEqual(copy.judges, source.judges);
      assert.deepEqual(copy.clips, source.clips); assert.deepEqual(copy.voiceLabels, source.voiceLabels);
      assert.ok(copy.results.every(result => result.status === 'pending' && !result.assessment));
      assert.equal(JSON.stringify(await backend.store.read<Job>(path.join('jobs', `${source.id}.json`))), original);
      assert.equal(calls, 0);
      const deleted = await (await post('/api/jobs/bulk', { action: 'delete', ids: [source.id, missingId, queued.id, copy.id] })).json() as BulkTestResult;
      assert.deepEqual(deleted.succeeded, [{ id: source.id }]); assert.equal(deleted.failed.length, 3);
      assert.equal(await backend.store.exists(path.join('jobs', `${source.id}.json`)), false);
      assert.equal(await backend.store.hasPcm(saved.id), true);
      await post('/api/queue/start', { consent: true });
      await until(async () => await (await fetch(url + '/api/queue')).json() as TestQueueState, state => !state.active && !state.waiting.length);
      assert.equal(calls, 2);
      assert.equal((await backend.store.read<Job>(path.join('jobs', `${copy.id}.json`))).status, 'completed');
    } finally {
      backend.cancelActive(); server.close(); await once(server, 'close');
      await rm(root, { recursive: true, force: true });
    }
  });
  backend.app.use(backend.errors); server.on('request', backend.app);
  const url = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const state = async () => await (await fetch(url + '/api/queue')).json() as TestQueueState;
  const judge = { id: randomUUID(), name: 'Judge', deployment: 'deployment' };
  const saved = clip();
  await backend.store.saveClip(saved, Buffer.alloc(48000));
  try {
    await post('/api/queue/pause', {});
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => post('/api/jobs', {
      name: `Concurrent ${index}`, profile: { ...profile, target: `Concurrent ${index}` },
      clipIds: [saved.id], consent: true, enqueue: true, judges: [judge],
    })));
    assert.ok(responses.every(response => response.status === 201));
    await Promise.all(responses.map(response => response.json()));
    const persisted = (await backend.store.jobs()).sort((a, b) => a.queueOrder! - b.queueOrder!);
    assert.equal(persisted.length, 6);
    assert.equal(new Set(persisted.map(job => job.queueOrder)).size, 6);
    assert.deepEqual((await state()).waiting.map(job => job.id), persisted.map(job => job.id));
    assert.deepEqual(calls, []);
    const save = backend.store.saveJob.bind(backend.store);
    let fail = true;
    backend.store.saveJob = async job => {
      if (fail && job.status === 'running') { fail = false; throw new Error('Synthetic disk failure'); }
      return save(job);
    };
    await post('/api/queue/start', { consent: true });
    const paused = await state();
    assert.equal(paused.paused, true);
    assert.match(paused.error!, /Synthetic disk failure/);
    assert.equal(paused.waiting.length, 6);
    assert.deepEqual(calls, []);
    assert.equal((await backend.store.read<Job>(path.join('jobs', `${persisted[0].id}.json`))).status, 'queued');
    await post('/api/queue/start', { consent: true });
    await until(state, value => !value.active && !value.waiting.length);
    assert.deepEqual(calls, persisted.map(job => job.profile.target));
    assert.equal((await state()).error, undefined);
  } finally {
    backend.cancelActive(); server.close(); await once(server, 'close');
    await rm(root, { recursive: true, force: true });
  }
});
