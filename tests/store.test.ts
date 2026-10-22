import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../server/store.js';

test('temporary Windows rename locks retry the same atomic save without losing queued updates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-store-lock-'));
  const failures = ['EPERM', 'EACCES', 'EBUSY'];
  let calls = 0;
  const store = new Store(root, async (source, destination) => {
    calls++;
    const code = failures.shift();
    if (code) throw Object.assign(new Error('Simulated temporary Windows lock'), { code });
    await rename(source, destination);
  });
  try {
    await store.init();
    await Promise.all([
      store.save('settings.json', { version: 1 }),
      store.save('settings.json', { version: 2 }),
      store.save('settings.json', { version: 3 }),
    ]);
    assert.equal(calls, 6, 'Three locked attempts and three successful queued writes.');
    assert.deepEqual(await store.read('settings.json'), { version: 3 });
    assert.equal(await store.exists('settings.json.tmp'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a persistent lock fails after six retries and preserves the previous valid JSON and queued saves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-store-permanent-'));
  let blocked = false, calls = 0;
  const failure = Object.assign(new Error('Persistent Windows lock'), { code: 'EPERM' });
  const store = new Store(root, async (source, destination) => {
    calls++;
    if (blocked) throw failure;
    await rename(source, destination);
  });
  try {
    await store.init();
    await store.save('settings.json', { version: 1 });
    blocked = true; calls = 0;
    await assert.rejects(store.save('settings.json', { version: 2 }), error => error === failure);
    assert.equal(calls, 7, 'One attempt plus exactly six bounded retries.');
    assert.deepEqual(await store.read('settings.json'), { version: 1 }, 'Never delete/truncate the existing destination.');
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'settings.json.tmp'), 'utf8')), { version: 2 });
    blocked = false;
    await store.save('settings.json', { version: 3 });
    assert.deepEqual(await store.read('settings.json'), { version: 3 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('non-lock errors are surfaced immediately, not retried or replaced with a success fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-store-error-'));
  let calls = 0;
  const failure = Object.assign(new Error('Simulated disk failure'), { code: 'ENOSPC' });
  const store = new Store(root, async () => { calls++; throw failure; });
  try {
    await store.init();
    await assert.rejects(store.save('settings.json', {}), error => error === failure);
    assert.equal(calls, 1);
    assert.equal(await store.exists('settings.json'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a real Windows destination-file lock can clear without interrupting an atomic save', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-store-windows-'));
  let attempts = 0;
  const store = new Store(root, async (source, destination) => {
    attempts++;
    await rename(source, destination);
  });
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  try {
    await store.init();
    await store.save('settings.json', { version: 1 }); attempts = 0;
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$stream = [IO.File]::Open($env:VOICE_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); try { [Console]::WriteLine('LOCKED'); [Console]::Out.Flush(); [Threading.Thread]::Sleep(600) } finally { $stream.Dispose() }",
    ], { env: { ...process.env, VOICE_LOCK_FILE: path.join(root, 'settings.json') } });
    exited = once(child, 'close');
    assert.ok(child.stdout);
    const [output] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
    assert.match(String(output), /LOCKED/);
    await store.save('settings.json', { version: 2 });
    assert.ok(attempts > 1, 'The test must encounter the actual Windows rename lock.');
    assert.deepEqual(await store.read('settings.json'), { version: 2 });
    assert.deepEqual(await exited, [0, null]);
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (exited) await exited;
    await rm(root, { recursive: true, force: true });
  }
});
