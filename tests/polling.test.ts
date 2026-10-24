import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startPolling } from '../src/polling.js';

test('polling reconnects after failures and continues delivering updates', { timeout: 2000 }, async () => {
  let calls = 0;
  const values: number[] = [], errors: unknown[] = [];
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const stop = startPolling(async () => {
    if (++calls === 1) throw new Error('Server restarting');
    return calls;
  }, value => { values.push(value); if (values.length === 2) finish(); }, error => errors.push(error), 1);
  try {
    await done;
    assert.deepEqual(values, [2, 3]);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /Server restarting/);
  } finally { stop(); }
});

test('polling never overlaps requests and stops without late state updates', async () => {
  let calls = 0, updates = 0, errors = 0, signal: AbortSignal | undefined;
  let finish!: (value: number) => void;
  const pending = new Promise<number>(resolve => { finish = resolve; });
  const stop = startPolling(async input => { signal = input; calls++; return pending; },
    () => { updates++; }, () => { errors++; }, 1);
  await delay(15);
  assert.equal(calls, 1);
  stop();
  assert.equal(signal?.aborted, true);
  finish(1);
  await delay(5);
  assert.equal(updates, 0); assert.equal(errors, 0); assert.equal(calls, 1);
});

test('unresponsive polling requests time out rather than blocking reconnection', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (error: unknown) => void;
  const failed = new Promise<unknown>(resolve => { finish = resolve; });
  const stop = startPolling(signal => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), () => assert.fail('A timed-out request must not report success'), finish);
  try {
    context.mock.timers.tick(10000);
    assert.match(String(await failed), /Local app response timed out/);
  } finally { stop(); }
});
