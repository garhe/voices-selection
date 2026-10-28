import { test } from 'node:test';
import assert from 'node:assert/strict';
import { droppedFiles } from '../src/import.js';

function fileEntry(name: string): FileSystemFileEntry {
  return {
    name, isFile: true, isDirectory: false,
    file(resolve: FileCallback) { resolve(new File(['audio'], name)); },
  } as FileSystemFileEntry;
}
function directory(name: string, batches: FileSystemEntry[][]): FileSystemDirectoryEntry {
  return {
    name, isFile: false, isDirectory: true,
    createReader() {
      let index = 0;
      return { readEntries(resolve: FileSystemEntriesCallback) { resolve(batches[index++] ?? []); } };
    },
  } as FileSystemDirectoryEntry;
}
function data(entries: (FileSystemEntry | null)[], files: File[] = []) {
  return {
    items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    files,
  };
}

test('dropped folders preserve voice grouping and read all directory batches', async () => {
  const root = directory('collection', [
    [directory('Voice A', [[fileEntry('one.wav')], [directory('nested', [[fileEntry('two.mp3')]])]])],
    [directory('Voice B', [[fileEntry('three.wav')]]), fileEntry('direct.wav')],
  ]);
  const result = await droppedFiles(data([root]));
  assert.deepEqual(result.map(item => item.path), [
    'collection/Voice A/one.wav', 'collection/Voice A/nested/two.mp3',
    'collection/Voice B/three.wav', 'collection/direct.wav',
  ]);
  assert.deepEqual(result.map(item => item.file.name), ['one.wav', 'two.mp3', 'three.wav', 'direct.wav']);
});

test('plain dropped files work without directory-entry support', async () => {
  const file = new File(['audio'], 'voice.wav');
  assert.deepEqual(await droppedFiles(data([null], [file])), [{ file, path: 'voice.wav' }]);
  assert.deepEqual(await droppedFiles(data([])), []);
});

test('unreadable dropped entries fail explicitly instead of partially replacing a draft', async () => {
  await assert.rejects(droppedFiles(data([fileEntry('one.wav'), null])), /could not be read/);
  const broken = {
    name: 'broken', isDirectory: true, isFile: false,
    createReader: () => ({
      readEntries(_resolve: FileSystemEntriesCallback, reject: ErrorCallback) {
        reject(new DOMException('Access denied', 'NotReadableError'));
      },
    }),
  } as FileSystemDirectoryEntry;
  await assert.rejects(droppedFiles(data([broken])), /Access denied/);
});
