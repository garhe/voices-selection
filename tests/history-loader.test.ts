import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryLoader } from '../src/historyLoader.js';
import { testHistory, testStatusLabel, type TestHistory } from '../shared/history.js';
import { job } from './fixtures.js';

function legacySummary(value: ReturnType<typeof job>): TestHistory {
  const summary = testHistory(value);
  delete summary.incomplete;
  return summary;
}

test('legacy history derives Completed* for every incomplete test and caches completed results across polls', async () => {
  const complete = job();
  const incomplete = job();
  incomplete.results[0].assessment!.assessable = false;
  const jobs = [complete, incomplete];
  let requests = 0;
  const load = createHistoryLoader(async () => jobs.map(legacySummary), async id => {
    requests++;
    return jobs.find(value => value.id === id)!;
  });
  for (let poll = 0; poll < 3; poll++)
    assert.deepEqual((await load()).map(testStatusLabel), ['Completed', 'Completed*']);
  assert.equal(requests, 2, 'Each immutable completed test is read only once, not every poll.');
});

test('current server history flags are authoritative without extra job downloads', async () => {
  const entries = [testHistory(job()), { ...testHistory(job()), incomplete: true }];
  const load = createHistoryLoader(async () => entries, async () => {
    throw new Error('Modern history must not download full jobs.');
  });
  assert.deepEqual((await load()).map(testStatusLabel), ['Completed', 'Completed*']);
});

test('active tests invalidate cached completion and receive fresh checks after a retry finishes', async () => {
  const value = job();
  value.results[0].assessment!.assessable = false;
  let requests = 0;
  const load = createHistoryLoader(async () => [legacySummary(value)], async () => {
    requests++;
    return value;
  });
  assert.equal(testStatusLabel((await load())[0]), 'Completed*');
  value.status = 'running';
  assert.equal(testStatusLabel((await load())[0]), 'Running');
  assert.equal(requests, 1);
  value.results[0].assessment!.assessable = true;
  value.status = 'completed';
  assert.equal(testStatusLabel((await load())[0]), 'Completed');
  assert.equal(requests, 2);
});

test('explicit refresh invalidates completion even when the legacy summary is unchanged', async () => {
  const value = job();
  const entry = legacySummary(value);
  let requests = 0;
  const load = createHistoryLoader(async () => [entry], async () => { requests++; return value; });
  assert.equal(testStatusLabel((await load())[0]), 'Completed');
  value.results[0].assessment!.languageSupported = false;
  assert.equal(testStatusLabel((await load(undefined, true))[0]), 'Completed*');
  assert.equal(requests, 2);
});

test('legacy job reads are bounded and preserve history order', async () => {
  const jobs = Array.from({ length: 11 }, () => job());
  let active = 0;
  let maximum = 0;
  const load = createHistoryLoader(async () => jobs.map(legacySummary), async id => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return jobs.find(value => value.id === id)!;
  });
  assert.deepEqual((await load()).map(entry => entry.id), jobs.map(value => value.id));
  assert.equal(maximum, 4);
});

test('history read failures remain errors rather than falsely reporting complete results', async () => {
  const value = job();
  let failed = true;
  const load = createHistoryLoader(async () => [legacySummary(value)], async () => {
    if (failed) throw new Error('Saved assessment could not be read.');
    return value;
  });
  await assert.rejects(load(), /Saved assessment could not be read/);
  failed = false;
  assert.equal(testStatusLabel((await load())[0]), 'Completed');
});

test('aborted history reads do not populate the completed-result cache', async () => {
  const value = job();
  const controller = new AbortController();
  let requests = 0;
  const load = createHistoryLoader(async () => [legacySummary(value)], async (_id, signal) => {
    requests++;
    if (signal) {
      assert.equal(signal, controller.signal);
      controller.abort(new Error('Stopped history check.'));
    }
    return value;
  });
  await assert.rejects(load(controller.signal), /Stopped history check/);
  assert.equal(testStatusLabel((await load())[0]), 'Completed');
  assert.equal(requests, 2);
});
