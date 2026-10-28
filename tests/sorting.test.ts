import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { FolderSorting } from '../server/sorting.js';
import { createApp } from '../server/app.js';
import { parseSortingPaths, sortingRequestSchema } from '../shared/sorting.js';

test('pasted quoted lists preserve all 32 collection paths, spaces, locale and gender tokens', () => {
  const locales = ['cs-CZ', 'da-DK', 'en-AU', 'fi-FI', 'he-IL', 'hr-HR', 'hu-HU', 'nb-NO', 'nl-NL', 'pl-PL', 'pt-PT', 'ro-RO', 'sk-SK', 'sl-SI', 'bg-BG', 'ca-ES'];
  const expected = locales.flatMap(locale => ['M', 'F'].map(gender => `D:\\Work Folder\\Competitors best voices\\11labs_${locale}_${gender}`));
  for (const newline of ['\r\n', '\n', '\r']) {
    const text = `  ${newline}${expected.map(directory => `  "${directory}"  `).join(newline)}${newline}  `;
    const paths = parseSortingPaths(text);
    assert.deepEqual(paths, expected);
    assert.equal(sortingRequestSchema.parse({ paths }).paths.length, 32);
  }
  assert.deepEqual(parseSortingPaths(`"${expected[0]}"\n\n${expected[1]}`), expected.slice(0, 2));
  assert.deepEqual(parseSortingPaths(' \r\n\t'), []);
});

async function collection(root: string, name: string) {
  const source = path.join(root, name);
  const voice = path.join(source, 'TTS', 'Voice A');
  await mkdir(path.join(voice, 'nested'), { recursive: true });
  await mkdir(path.join(source, 'NonTTS', 'Voice B'), { recursive: true });
  await writeFile(path.join(voice, 'one.wav'), 'first WAV');
  await writeFile(path.join(voice, 'nested', 'one.wav'), 'duplicate WAV');
  await writeFile(path.join(source, 'NonTTS', 'Voice B', 'two.WAV'), 'second voice');
  await writeFile(path.join(source, 'notes.txt'), 'omitted file');
  return source;
}

test('folder sorting previews and replaces multiple collections with exact duplicate names and file bytes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-ui-'));
  try {
    const first = await collection(root, "first's collection");
    const second = await collection(root, 'collection-音声');
    const sorter = new FolderSorting(path.join(root, 'app-data'));
    const preview = await sorter.plan({ paths: [first, second, path.join(root, 'missing')], mode: 'replace', nameFormat: '{name}' });
    assert.equal(preview.entries.length, 3);
    assert.equal(preview.entries[0].plan?.wavFiles, 3);
    assert.equal(preview.entries[0].plan?.voiceFolders, 2);
    assert.equal(preview.entries[0].plan?.renamedFiles, 1);
    assert.equal(preview.entries[0].plan?.omittedFiles, 1);
    assert.equal(preview.entries[0].plan?.mappings.length, 3);
    assert.match(preview.entries[2].error!, /ENOENT/);
    assert.equal(await readFile(path.join(first, 'notes.txt'), 'utf8'), 'omitted file', 'Preview must not mutate originals.');
    assert.deepEqual((await readdir(first)).sort(), ['NonTTS', 'TTS', 'notes.txt']);
    await assert.rejects(sorter.apply({ token: preview.token, confirmed: false }), /Invalid literal/);
    const results = await sorter.apply({ token: preview.token, confirmed: true });
    assert.deepEqual(results.entries, [{ source: first, output: first }, { source: second, output: second }]);
    for (const source of [first, second]) {
      assert.deepEqual((await readdir(source)).sort(), ['Voice A', 'Voice B']);
      assert.deepEqual((await readdir(path.join(source, 'Voice A'))).sort(), ['one.wav', 'one__2.wav']);
      const contents = await Promise.all(['one.wav', 'one__2.wav'].map(file => readFile(path.join(source, 'Voice A', file), 'utf8')));
      assert.deepEqual(contents.sort(), ['duplicate WAV', 'first WAV']);
      assert.equal(await readFile(path.join(source, 'Voice B', 'two.WAV'), 'utf8'), 'second voice');
    }
    assert.ok((await readdir(root)).every(name => !name.startsWith('.voice-sort-')));
    await assert.rejects(sorter.apply({ token: preview.token, confirmed: true }), /missing or expired/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('changed contents are rejected after preview without replacing or deleting source files', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-changed-'));
  try {
    const source = await collection(root, 'collection');
    const sorter = new FolderSorting(path.join(root, 'data'));
    const preview = await sorter.plan({ paths: [source], mode: 'replace', nameFormat: '{name}' });
    await writeFile(path.join(source, 'new-file.txt'), 'keep this');
    const result = await sorter.apply({ token: preview.token, confirmed: true });
    assert.match(result.entries[0].error!, /changed since preview/);
    assert.equal(result.entries[0].output, undefined);
    assert.equal(await readFile(path.join(source, 'new-file.txt'), 'utf8'), 'keep this');
    assert.equal(await readFile(path.join(source, 'notes.txt'), 'utf8'), 'omitted file');
    const refreshed = await sorter.plan({ paths: [source], mode: 'replace', nameFormat: '{name}' });
    assert.notEqual(refreshed.token, preview.token);
    await assert.rejects(sorter.apply({ token: preview.token, confirmed: true }), /missing or expired/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('more than twenty collections can be copied to a custom parent and name format while preserving every original', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-many-'));
  try {
    const outputDirectory = path.join(root, 'sorted output');
    await mkdir(outputDirectory);
    const sources: string[] = [];
    for (let index = 0; index < 21; index++) {
      const source = path.join(root, `collection-${index}`);
      await mkdir(path.join(source, 'TTS', 'Voice A'), { recursive: true });
      await writeFile(path.join(source, 'TTS', 'Voice A', 'one.wav'), `audio-${index}`);
      await writeFile(path.join(source, 'notes.txt'), `notes-${index}`);
      sources.push(source);
    }
    const sorter = new FolderSorting(path.join(root, 'data'));
    const preview = await sorter.plan({ paths: sources, outputDirectory, nameFormat: '{index}_{name}_sorted' });
    assert.equal(preview.mode, 'keep');
    assert.ok(Date.parse(preview.expiresAt) >= Date.now() + 598000, 'Large batches must receive ten minutes to confirm after preview completes.');
    assert.equal(preview.entries.length, 21);
    assert.ok(preview.entries.every(entry => entry.plan && !entry.error), JSON.stringify(preview.entries));
    assert.deepEqual(await readdir(outputDirectory), [], 'Preview must not create output folders.');
    await assert.rejects(sorter.apply({ token: preview.token, confirmed: true, mode: 'replace' }), /Unrecognized key/);
    const results = await sorter.apply({ token: preview.token, confirmed: true });
    assert.equal(results.mode, 'keep');
    assert.equal(results.entries.length, 21);
    for (const [index, source] of sources.entries()) {
      const output = path.join(outputDirectory, `${index + 1}_collection-${index}_sorted`);
      assert.deepEqual(results.entries[index], { source, output });
      assert.equal(preview.entries[index].output, output);
      assert.equal(await readFile(path.join(output, 'Voice A', 'one.wav'), 'utf8'), `audio-${index}`);
      assert.deepEqual(await readdir(output), ['Voice A']);
      assert.equal(await readFile(path.join(source, 'TTS', 'Voice A', 'one.wav'), 'utf8'), `audio-${index}`);
      assert.equal(await readFile(path.join(source, 'notes.txt'), 'utf8'), `notes-${index}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('replacement supports a new output location and name, and never overwrites an output created after preview', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-relocate-'));
  try {
    const source = await collection(root, "original's 音声");
    const outputDirectory = path.join(root, 'exports');
    await mkdir(outputDirectory);
    const sorter = new FolderSorting(path.join(root, 'data'));
    const preview = await sorter.plan({ paths: [source], mode: 'replace', outputDirectory, nameFormat: '{name}_clean' });
    const output = path.join(outputDirectory, `${path.basename(source)}_clean`);
    assert.ok(preview.entries[0].plan, preview.entries[0].error);
    assert.equal(preview.entries[0].output, output);
    assert.equal(await readFile(path.join(source, 'notes.txt'), 'utf8'), 'omitted file');
    const result = await sorter.apply({ token: preview.token, confirmed: true });
    assert.deepEqual(result, { mode: 'replace', entries: [{ source, output }] });
    await assert.rejects(readdir(source), /ENOENT/);
    assert.deepEqual((await readdir(output)).sort(), ['Voice A', 'Voice B']);
    assert.equal(await readFile(path.join(output, 'Voice B', 'two.WAV'), 'utf8'), 'second voice');
    assert.ok((await readdir(root)).every(name => !name.startsWith('.voice-sort-')));
    assert.ok((await readdir(outputDirectory)).every(name => !name.startsWith('.voice-sort-')));

    const other = await collection(root, 'other');
    const pending = await sorter.plan({ paths: [other], mode: 'replace', outputDirectory });
    const occupied = pending.entries[0].output!;
    await mkdir(occupied);
    await writeFile(path.join(occupied, 'important.txt'), 'do not overwrite');
    const rejected = await sorter.apply({ token: pending.token, confirmed: true });
    assert.match(rejected.entries[0].error!, /Output already exists/);
    assert.equal(await readFile(path.join(occupied, 'important.txt'), 'utf8'), 'do not overwrite');
    assert.equal(await readFile(path.join(other, 'notes.txt'), 'utf8'), 'omitted file');
    const existing = await sorter.plan({ paths: [other], mode: 'keep', outputDirectory });
    assert.match(existing.entries[0].error!, /Output already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('output options reject unsafe names, conflicting paths, missing parents and filesystem aliases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-output-guards-'));
  try {
    const source = await collection(root, 'collection');
    const sorter = new FolderSorting(path.join(root, 'data'));
    for (const nameFormat of ['../elsewhere', '{unknown}', 'CON', 'NUL.txt', 'name.', '{name}\\child', 'bad:name'])
      await assert.rejects(sorter.plan({ paths: [source], nameFormat }), /Invalid output|Unknown folder/);
    await assert.rejects(sorter.plan({ paths: [source], nameFormat: '{name}' }), /must not overlap/);
    await assert.rejects(sorter.plan({ paths: [source], mode: 'replace', outputDirectory: source }), /must not overlap/);
    await assert.rejects(sorter.plan({ paths: [source], outputDirectory: 'relative-output' }), /absolute output/);
    const other = await collection(root, 'other');
    await assert.rejects(sorter.plan({ paths: [source, other], outputDirectory: root, nameFormat: 'fixed' }), /must be unique/);
    const protectedOutput = await sorter.plan({ paths: [source], outputDirectory: path.join(root, 'data') });
    assert.match(protectedOutput.entries[0].error!, /Application, system/);
    const missing = await sorter.plan({ paths: [source], outputDirectory: path.join(root, 'missing') });
    assert.match(missing.entries[0].error!, /ENOENT/);
    if (process.platform === 'win32') {
      const parent = path.join(root, 'real-output');
      const alias = path.join(root, 'linked-output');
      await mkdir(parent);
      await symlink(parent, alias, 'junction');
      const linked = await sorter.plan({ paths: [source], outputDirectory: alias });
      assert.match(linked.entries[0].error!, /link|junction/);
    }
    assert.equal(await readFile(path.join(source, 'notes.txt'), 'utf8'), 'omitted file');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('folder sorting rejects broad paths, overlaps, links, root WAVs and invalid input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-guards-'));
  try {
    const source = await collection(root, 'collection');
    const sorter = new FolderSorting(path.join(root, 'data'));
    await assert.rejects(sorter.plan({ paths: [source, source] }), /unique.*overlap/);
    await assert.rejects(sorter.plan({ paths: [source, path.join(source, 'TTS')] }), /overlap/);
    for (const input of [{ paths: [] }, { paths: [source], command: 'ignored' }])
      assert.equal(sortingRequestSchema.safeParse(input).success, false);
    assert.equal(sortingRequestSchema.parse({ paths: Array.from({ length: 1000 }, (_, index) => `${source}-${index}`) }).paths.length, 1000);
    const protectedPaths = [path.parse(root).root, os.homedir(), process.cwd(), path.join(root, 'data'), 'relative-collection'];
    const preview = await sorter.plan({ paths: [protectedPaths[0]] });
    assert.match(preview.entries[0].error!, /root/);
    for (const source of protectedPaths.slice(1)) {
      const result = await sorter.plan({ paths: [source] });
      assert.ok(result.entries[0].error, source);
      assert.equal(result.entries[0].plan, undefined);
    }
    await assert.rejects(sorter.apply({ token: preview.token, confirmed: true }), /missing or expired/);
    if (process.platform === 'win32') {
      await writeFile(path.join(source, 'root.wav'), 'root audio');
      const invalid = await sorter.plan({ paths: [source] });
      assert.match(invalid.entries[0].error!, /no voice folder/);
      await assert.rejects(sorter.apply({ token: invalid.token, confirmed: true }), /No valid directories/);
      const link = path.join(root, 'link');
      await symlink(source, link, 'junction');
      const linked = await sorter.plan({ paths: [link] });
      assert.match(linked.entries[0].error!, /link|junction/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('folder sorting API requires a local host, valid preview and explicit replacement confirmation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-sort-api-'));
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const { app, errors } = await createApp({ dataDir: path.join(root, 'data'), port: address.port });
    app.use(errors); server.on('request', app);
    const post = (route: string, body: unknown, origin?: string) => fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
    });
    assert.equal((await post('/api/folders/preview', { paths: [] })).status, 400);
    assert.equal((await post('/api/folders/preview', { paths: [root] }, 'https://other.example')).status, 403);
    const source = await collection(root, 'collection');
    const response = await post('/api/folders/preview', { paths: [source] });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal((await post('/api/folders/apply', { token: preview.token })).status, 400);
    assert.equal(await readFile(path.join(source, 'notes.txt'), 'utf8'), 'omitted file');
    assert.equal((await post('/api/folders/apply', { token: '00000000-0000-4000-8000-000000000001', confirmed: true })).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
