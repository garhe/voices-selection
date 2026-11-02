import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { batchDirectorySchema, supportedAudio, type BatchPreview, type BatchTest } from '../shared/batch.js';
import { testNameSchema } from '../shared/domain.js';
import { testNameMetadata } from '../shared/history.js';

type Source = { path: string; size: number; mtimeMs: number };
export class BatchImport {
  private preview?: { token: string; files: Map<string, Source> };

  async plan(input: unknown): Promise<BatchPreview> {
    const { directory } = batchDirectorySchema.parse(input);
    if (!path.isAbsolute(directory)) throw new Error('Enter an absolute batch parent directory on the local server.');
    const root = path.resolve(directory);
    if (path.parse(root).root === root) throw new Error('Choose a batch directory, not a drive root.');
    await this.validate(root, true);
    const files = new Map<string, Source>();
    const response: BatchPreview = { token: randomUUID(), directory: root, tests: [], ignoredFiles: 0 };
    for (const name of (await readdir(root)).sort()) {
      const testPath = path.join(root, name);
      const stat = await this.validate(testPath);
      if (!stat.isDirectory()) {
        if (supportedAudio.test(name)) throw new Error(`Audio must be inside test and voice folders: ${name}`);
        response.ignoredFiles++; continue;
      }
      const validation = testNameSchema.safeParse(name);
      const test: BatchTest = { name, ...testNameMetadata(name), files: [], errors: [] };
      if (!validation.success) test.errors.push(validation.error.issues[0].message);
      const visit = async (directory: string, voice?: string): Promise<void> => {
        for (const child of (await readdir(directory)).sort()) {
          const absolute = path.join(directory, child);
          const entry = await this.validate(absolute);
          if (entry.isDirectory()) { await visit(absolute, voice ?? child); continue; }
          if (!supportedAudio.test(child)) { response.ignoredFiles++; continue; }
          if (!voice) { test.errors.push(`Place audio in a voice subfolder: ${child}`); continue; }
          const relative = path.relative(root, absolute);
          if (voice.length > 200 || relative.length > 500) {
            test.errors.push(`Voice name or audio path is too long: ${relative}`); continue;
          }
          if (!entry.size || entry.size > 100 * 1024 * 1024)
            test.errors.push(`Audio must be nonempty and no larger than 100 MB: ${relative}`);
          const id = randomUUID();
          test.files.push({ id, path: relative, voice, size: entry.size });
          files.set(id, { path: absolute, size: entry.size, mtimeMs: entry.mtimeMs });
        }
      };
      await visit(testPath);
      if (!test.files.length) test.errors.push('No supported audio found in voice subfolders.');
      if (test.files.length > 200) test.errors.push('Each test supports at most 200 role/audio inputs. Split this test into smaller folders.');
      response.tests.push(test);
    }
    if (!response.tests.length) throw new Error('No test folders found. Use parent directory → test folders → voice folders → audio files.');
    this.preview = { token: response.token, files };
    return response;
  }

  private async validate(source: string, directory = false) {
    const stat = await lstat(source);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (directory && !stat.isDirectory()))
      throw new Error(`Choose real files and directories, not links or junctions: ${source}`);
    const resolved = await realpath(source);
    if (path.relative(resolved, source) !== '')
      throw new Error(`Paths through links or junctions are not supported: ${source}`);
    return stat;
  }

  async audio(token: string, id: string): Promise<Buffer> {
    const source = this.preview?.token === token ? this.preview.files.get(id) : undefined;
    if (!source) throw new Error('Batch preview expired or audio is unknown. Preview the directory again.');
    const stat = await this.validate(source.path);
    if (stat.size !== source.size || stat.mtimeMs !== source.mtimeMs)
      throw new Error('Batch audio changed after preview. Preview the directory again.');
    return readFile(source.path);
  }
}
