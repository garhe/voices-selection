import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BatchImport } from '../server/batch.js';
import { createApp } from '../server/app.js';
import { BatchEvaluation } from '../src/BatchEvaluation.js';
import { batchTestProfile, submitBatch, type BatchSubmission } from '../src/batch.js';
import { prepareEvaluationClips } from '../src/evaluation.js';
import { newTestProfile } from '../src/readiness.js';
import { MAX_SECONDS, DEFAULT_RUBRIC, type Job, type Clip, type TestQueueState } from '../shared/domain.js';
import { batchDirectorySchema, type BatchPreview, type BatchTest } from '../shared/batch.js';
import { parseSortingPaths as parseFolderPaths } from '../shared/sorting.js';
import type { TestHistory } from '../shared/history.js';
import { assessment } from './fixtures.js';

const judges = [{ id: randomUUID(), name: 'Batch judge', deployment: 'test-deployment' }];
async function audioFile(root: string, relative: string, contents = Buffer.from('audio')) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return file;
}
const testFolder = (name: string): BatchTest => ({
  name, languages: [], genders: ['Unspecified'], files: [], errors: [],
});

test('batch directory discovery preserves tests, voices, nested audio and filename metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-batch-'));
  try {
    await audioFile(root, 'en-US_F/Voice A/one.wav');
    await audioFile(root, 'en-US_F/Voice A/nested/two.mp3');
    await audioFile(root, 'en-US_F/Voice B/one.wav');
    await audioFile(root, 'thTH_M/Thai/three.opus');
    await audioFile(root, 'notes.txt');
    await audioFile(root, 'en-US_F/Voice A/readme.txt');
    const importer = new BatchImport();
    const preview = await importer.plan({ directory: `"${root}"` });
    assert.deepEqual(preview.tests.map(test => [test.name, test.languages, test.genders, test.files.length, test.errors]), [
      ['en-US_F', ['en-US'], ['Female'], 3, []], ['thTH_M', ['th-TH'], ['Male'], 1, []],
    ]);
    assert.equal(preview.ignoredFiles, 2);
    assert.deepEqual(preview.tests[0].files.map(file => file.voice), ['Voice A', 'Voice A', 'Voice B']);
    const first = preview.tests[0].files[0];
    assert.equal(first.path, path.join('en-US_F', 'Voice A', 'nested', 'two.mp3'));
    assert.deepEqual(await importer.audio(preview.token, first.id), Buffer.from('audio'));
    await assert.rejects(importer.audio(preview.token, randomUUID()), /unknown/);
    await assert.rejects(importer.audio(randomUUID(), first.id), /expired/);
    await writeFile(path.join(root, first.path), 'changed contents');
    await assert.rejects(importer.audio(preview.token, first.id), /changed after preview/);
    const next = await importer.plan({ directory: root });
    await assert.rejects(importer.audio(preview.token, next.tests[0].files[0].id), /expired/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid layouts, empty tests, limits, and links fail explicitly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-batch-invalid-'));
  const importer = new BatchImport();
  try {
    await assert.rejects(importer.plan({ directory: 'relative' }), /absolute/);
    await assert.rejects(importer.plan({ directory: path.parse(root).root }), /drive root/);
    await assert.rejects(importer.plan({ directory: root }), /No test folders/);
    await audioFile(root, 'direct.wav');
    await assert.rejects(importer.plan({ directory: root }), /test and voice folders/);
    await rm(path.join(root, 'direct.wav'));
    await audioFile(root, 'empty/direct.wav');
    await audioFile(root, 'invalid/Voice/empty.wav', Buffer.alloc(0));
    for (let index = 0; index < 201; index++) await audioFile(root, `too-many/Voice/${index}.wav`);
    const result = await importer.plan({ directory: root });
    assert.match(result.tests[0].errors.join(' '), /voice subfolder.*No supported audio/);
    assert.match(result.tests[1].errors.join(' '), /nonempty/);
    assert.match(result.tests[2].errors.join(' '), /at most 200/);
    await rm(path.join(root, 'too-many', 'Voice', '200.wav'));
    const boundary = await importer.plan({ directory: root });
    assert.equal(boundary.tests[2].files.length, 200);
    assert.deepEqual(boundary.tests[2].errors, []);
    await symlink(path.join(root, 'invalid'), path.join(root, 'linked'), 'junction');
    await assert.rejects(importer.plan({ directory: root }), /links or junctions/);
    await assert.rejects(importer.plan({ directory: path.join(root, 'linked') }), /links or junctions/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch folder lists accept quoted paths and preserve spaces across different parents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-batch-list-'));
  try {
    const first = path.join(root, 'Work Folder', 'es-ES_M_039_01_revised_MatchFile');
    const second = path.join(root, 'Other Folder', 'pt-BR Female VTS');
    await audioFile(first, 'Voice A/nested/one.wav', Buffer.from('first'));
    await audioFile(second, 'Voice B/two.mp3', Buffer.from('second'));
    await audioFile(second, 'Voice B/readme.txt');
    await audioFile(root, 'Work Folder/unselected/Voice/three.wav');
    const directories = parseFolderPaths(`"${first}"\r\n\n  "${second}"  \r\n"${first}"`);
    const importer = new BatchImport();
    const preview = await importer.plan({ directories });
    assert.ok('directories' in preview);
    assert.deepEqual(preview.directories, [first, second]);
    assert.deepEqual(preview.tests.map(test => [test.name, test.languages, test.genders, test.errors]), [
      [path.basename(first), ['es-ES'], ['Male'], []],
      [path.basename(second), ['pt-BR'], ['Female'], []],
    ]);
    assert.equal(preview.ignoredFiles, 1);
    assert.equal(preview.tests[0].files[0].path, path.join(path.basename(first), 'Voice A', 'nested', 'one.wav'));
    assert.deepEqual(await importer.audio(preview.token, preview.tests[0].files[0].id), Buffer.from('first'));
    assert.deepEqual(await importer.audio(preview.token, preview.tests[1].files[0].id), Buffer.from('second'));
    const quoted = await importer.plan({ directories: [`"${second}"`] });
    assert.deepEqual(quoted.tests.map(test => test.name), [path.basename(second)]);
    await assert.rejects(importer.audio(preview.token, preview.tests[0].files[0].id), /expired/);
    await writeFile(path.join(second, 'Voice B', 'two.mp3'), 'changed contents');
    await assert.rejects(importer.audio(quoted.token, quoted.tests[0].files[0].id), /changed after preview/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch folder lists reject invalid sources and duplicate test names explicitly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-batch-list-invalid-'));
  const importer = new BatchImport();
  try {
    for (const input of [{ directories: [] }, { directories: ['""'] }, { directory: root, directories: [root] }])
      assert.equal(batchDirectorySchema.safeParse(input).success, false);
    await assert.rejects(importer.plan({ directories: [root, 'relative'] }), /absolute/);
    await assert.rejects(importer.plan({ directories: [path.parse(root).root] }), /drive root/);
    await assert.rejects(importer.plan({ directories: [path.join(root, 'missing')] }), /ENOENT/);
    const file = await audioFile(root, 'not-a-folder.txt');
    await assert.rejects(importer.plan({ directories: [file] }), /real files and directories/);
    const empty = path.join(root, 'empty');
    await mkdir(empty);
    assert.match((await importer.plan({ directories: [empty] })).tests[0].errors.join(' '), /No supported audio/);
    await audioFile(empty, 'direct.wav');
    assert.match((await importer.plan({ directories: [empty] })).tests[0].errors.join(' '), /voice subfolder/);
    const first = path.join(root, 'one', 'en-US_F');
    const second = path.join(root, 'two', 'en-US_F');
    await audioFile(first, 'Voice/one.wav');
    await audioFile(second, 'Voice/two.wav');
    await assert.rejects(importer.plan({ directories: [first, second] }), /names must be unique.*en-US_F/);
    const linked = path.join(root, 'linked');
    await symlink(first, linked, 'junction');
    await assert.rejects(importer.plan({ directories: [linked] }), /links or junctions/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch preview enforces the exact 100 MB per-file boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-batch-size-'));
  try {
    const file = await audioFile(root, 'en-US_F/Voice/large.wav');
    await truncate(file, 100 * 1024 * 1024);
    const importer = new BatchImport();
    assert.deepEqual((await importer.plan({ directory: root })).tests[0].errors, []);
    await truncate(file, 100 * 1024 * 1024 + 1);
    assert.match((await importer.plan({ directory: root })).tests[0].errors.join(' '), /100 MB/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch submissions use one shared snapshot, per-test locale, sequential order and explicit partial failures', async () => {
  const profile = newTestProfile();
  profile.stage = 'tts'; profile.scope = 'both'; profile.target = 'Shared guide';
  profile.speakerMode = 'manual'; profile.language = 'ja-JP'; profile.targetMarket = 'Japan';
  const tests = [testFolder('en-US_F'), testFolder('fr-FR_M'), testFolder('no metadata')];
  const results: BatchSubmission[] = [];
  const calls: string[] = [];
  let running = 0;
  await submitBatch(tests, profile, judges, async (test, evaluation, panel) => {
    assert.equal(++running, 1);
    assert.equal(evaluation.stage, 'tts'); assert.equal(evaluation.scope, 'both');
    assert.equal(evaluation.speakerMode, 'automatic'); assert.equal(evaluation.target, 'Shared guide');
    assert.deepEqual(evaluation.rubric, profile.rubric);
    assert.equal(panel[0].name, 'Batch judge');
    panel[0].name = 'Changed locally';
    calls.push(`${test.name}:${evaluation.language}:${evaluation.targetMarket}`);
    await new Promise(resolve => setTimeout(resolve, 1));
    running--;
    if (test.name === 'fr-FR_M') throw new Error('Cannot decode audio');
    return { id: randomUUID() };
  }, result => results.push(result));
  assert.deepEqual(calls, ['en-US_F:en-US:en-US', 'fr-FR_M:fr-FR:fr-FR', 'no metadata:auto:']);
  assert.equal(results.filter(result => result.id).length, 2);
  assert.equal(results[1].error, 'Cannot decode audio');
  const remaining = tests.filter(test => !results.some(result => result.name === test.name && result.id));
  assert.deepEqual(remaining.map(test => test.name), ['fr-FR_M']);
  await submitBatch(remaining, profile, judges, async test => {
    assert.equal(test.name, 'fr-FR_M'); return { id: randomUUID() };
  }, result => { assert.ok(result.id); });
  assert.equal(batchTestProfile(profile, 'en-US fr-FR').language, 'auto');
  assert.equal(profile.language, 'ja-JP');
  assert.equal(judges[0].name, 'Batch judge');
});

test('shared clip preparation keeps complete windows, voice grouping, role selection and the 200-input limit', async () => {
  const profile = { ...newTestProfile(), scope: 'both' as const };
  const recording = {
    id: randomUUID(), file: new File(['audio'], 'voice.wav'), path: 'test/Voice/voice.wav',
    voice: 'Voice', language: 'fr-FR', regions: [], include: true,
  };
  const uploads: Clip[] = [];
  const audio = {
    decode: async () => ({ duration: MAX_SECONDS + 1 }) as AudioBuffer,
    toPcm: async () => new ArrayBuffer(48000),
  };
  const ids = await prepareEvaluationClips([recording], profile,
    async clip => { uploads.push(clip); }, () => {}, [], audio);
  assert.equal(ids.length, 4);
  assert.deepEqual(uploads.map(clip => clip.role), ['agent', 'customer', 'agent', 'customer']);
  assert.equal(uploads[0].start, 0); assert.equal(uploads[2].end, MAX_SECONDS + 1);
  assert.ok(uploads.every(clip => clip.voice === 'Voice' && clip.language === 'fr-FR' && clip.file === recording.path));
  await assert.rejects(prepareEvaluationClips([recording], profile, async () => {
    assert.fail('Over-limit audio must not upload');
  }, () => {}, Array.from({ length: 198 }, () => randomUUID()), audio), /more than 200/);
  const initialIds = Array.from({ length: 196 }, () => randomUUID());
  assert.equal((await prepareEvaluationClips([recording], profile, async () => {}, () => {}, initialIds, audio)).length, 200);
  assert.equal(initialIds.length, 196);
  const manual: Clip[] = [];
  await prepareEvaluationClips([{ ...recording, regions: [{
    id: randomUUID(), role: 'agent', start: 4, end: 6, channel: 'right', confirmed: true,
  }] }], { ...profile, speakerMode: 'manual' }, async clip => { manual.push(clip); }, () => {}, [], audio);
  assert.deepEqual(manual.map(({ start, end, channel, role }) => ({ start, end, channel, role })),
    [{ start: 4, end: 6, channel: 'right', role: 'agent' }]);
  await assert.rejects(prepareEvaluationClips([recording], profile, async () => {}, () => {}, [], {
    ...audio, decode: async () => { throw new Error('Unsupported codec'); },
  }), /Unsupported codec/);
});

test('batch wizard initially requires shared settings and does not ask for a single test name', () => {
  const html = renderToStaticMarkup(createElement(BatchEvaluation, {
    profile: newTestProfile(), busy: false,
    onAction: async (_label, run) => run(),
    onPreview: async () => { throw new Error('Not called'); },
    onQueue: async () => { throw new Error('Not called'); }, onRefresh: async () => {},
  }));
  assert.match(html, /Step 1 of 2/);
  assert.match(html, /Continue to batch directory/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /Batch parent directory<input/);
});

test('batch submission has no Azure-rights checkbox but retains the usage notice and validation', () => {
  const source = readFileSync(new URL('../src/BatchEvaluation.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setConsent|checked=\{consent\}|!consent|I have permission/);
  assert.match(source, /No separate permission confirmation is required/);
  assert.match(source, /usage charges for every test, judge and automatic retry/);
  assert.match(source, /disabled=\{busy \|\| !settingsReady \|\| !pending\.length \|\| pending\.some/);
});

test('locale-dependent rubric readiness is checked per folder, not before directory selection', () => {
  const profile = newTestProfile();
  profile.rubric!.dimensions = profile.rubric!.dimensions.map(dimension => ({
    ...dimension, enabled: dimension.id === 'accentFit',
  }));
  const html = renderToStaticMarkup(createElement(BatchEvaluation, {
    profile, config: { judges, configured: true }, busy: false,
    onAction: async (_label, run) => run(),
    onPreview: async () => { throw new Error('Not called'); },
    onQueue: async () => { throw new Error('Not called'); }, onRefresh: async () => {},
  }));
  assert.doesNotMatch(html, /<button[^>]*disabled/);
  assert.equal(batchTestProfile(profile, 'en-US_F').targetMarket, 'en-US');
  assert.throws(() => batchTestProfile(profile, 'no metadata'), /no weighted dimensions active/);
});

test('local batch audio goes through normal saved jobs, FIFO queue and report history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-batch-api-'));
  const collection = path.join(root, 'collection');
  await audioFile(collection, 'en-US_F/Voice A/one.wav');
  await audioFile(collection, 'fr-FR_M/Voice B/two.wav');
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let concurrent = 0, maximum = 0;
  const languages: string[] = [];
  const backend = await createApp({
    dataDir: path.join(root, 'data'), port: address.port,
    endpoint: 'https://example.openai.azure.com', key: 'test-only',
    evaluate: async input => {
      maximum = Math.max(maximum, ++concurrent); languages.push(input.profile.language);
      await new Promise(resolve => setTimeout(resolve, 5)); concurrent--;
      const result = assessment();
      result.scores.contextFit = 4; result.scores.accentFit = 4;
      result.speakerAttribution = { role: 'agent', status: 'identified', evidence: 'The agent offers help.' };
      return { assessment: result };
    },
  });
  backend.app.use(backend.errors); server.on('request', backend.app);
  const url = `http://127.0.0.1:${address.port}`;
  const post = async <T,>(route: string, body: unknown): Promise<T> => {
    const response = await fetch(url + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json() as Promise<T>;
  };
  try {
    await post('/api/queue/pause', {});
    const parentPreview = await post<BatchPreview>('/api/batch/preview', { directory: collection });
    const preview = await post<BatchPreview>('/api/batch/preview', {
      directories: [path.join(collection, 'en-US_F'), `"${path.join(collection, 'fr-FR_M')}"`],
    });
    assert.deepEqual(preview.tests.map(test => test.name), parentPreview.tests.map(test => test.name));
    const ids: string[] = [];
    await submitBatch(preview.tests, newTestProfile(), judges, async (test, profile, panel) => {
      const clips: string[] = [];
      for (const source of test.files) {
        const response = await fetch(`${url}/api/batch/${preview.token}/audio/${source.id}`);
        assert.equal(response.status, 200); assert.equal(await response.text(), 'audio');
        const id = randomUUID();
        await post('/api/clips', {
          clip: { id, file: source.path, voice: source.voice, language: profile.language, role: 'agent', start: 0, end: 1, channel: 'mix' },
          pcm: Buffer.alloc(48000).toString('base64'),
        });
        clips.push(id);
      }
      const saved = await post<Job>('/api/jobs', {
        name: test.name, profile, judges: panel, clipIds: clips, enqueue: true, consent: true,
      });
      assert.deepEqual(saved.profile.rubric, DEFAULT_RUBRIC);
      assert.equal(saved.profile.speakerMode, 'automatic');
      ids.push(saved.id); return saved;
    }, result => { assert.ok(result.id, result.error); });
    const state = await (await fetch(url + '/api/queue')).json() as TestQueueState;
    assert.deepEqual(state.waiting.map(job => job.id), ids); assert.equal(state.paused, true);
    assert.equal(languages.length, 0);
    assert.deepEqual((await backend.store.jobs()).map(job => job.status), ['queued', 'queued']);
    await post('/api/queue/start', { consent: true });
    for (let attempt = 0; attempt < 200; attempt++) {
      const queue = await (await fetch(url + '/api/queue')).json() as TestQueueState;
      if (!queue.active && !queue.waiting.length) break;
      if (attempt === 199) assert.fail('Batch queue did not finish');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(maximum, 1);
    assert.deepEqual(languages, ['en-US', 'fr-FR']);
    const history = await (await fetch(url + '/api/jobs')).json() as TestHistory[];
    assert.deepEqual(history.map(job => [job.name, job.languages[0], job.genders[0]]).sort(), [
      ['en-US_F', 'en-US', 'Female'], ['fr-FR_M', 'fr-FR', 'Male'],
    ]);
    for (const id of ids) {
      const report = await (await fetch(`${url}/api/jobs/${id}`)).json() as Job;
      assert.equal(report.status, 'completed'); assert.equal(report.results.length, 1);
      assert.equal(report.results[0].status, 'completed');
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
