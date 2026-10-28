import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { sortingPlanSchema, sortingRequestSchema, sortingApplySchema, type SortingPreview, type SortingResults, type SortingRequest } from '../shared/sorting.js';

const script = fileURLToPath(new URL('../scripts/VoiceFolderSort.ps1', import.meta.url));
const project = path.dirname(path.dirname(script));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unexpected folder sorting failure.';
const within = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function runSorter(action: 'preview' | 'apply', source: string, output: string, mode: SortingRequest['mode']): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('Folder sorting currently requires the local Windows app and Windows PowerShell.');
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) { reject(new Error(stderr.trim() || error.message)); return; }
        const result = stdout.split(/\r?\n/).find(line => line.startsWith('VOICE_SORT_JSON:'));
        if (!result) { reject(new Error('The folder sorter returned no result. Check the installed PowerShell scripts.')); return; }
        try { resolve(JSON.parse(result.slice('VOICE_SORT_JSON:'.length))); }
        catch (error) { reject(new Error(`Invalid folder sorter response: ${errorText(error)}`)); }
      });
    child.stdin!.on('error', error => reject(error));
    child.stdin!.end(JSON.stringify({ action, source, output, mode }));
  });
}

export class FolderSorting {
  private busy = false;
  private preview?: { response: SortingPreview; snapshots: Map<string, { snapshot: string; output: string }> };
  constructor(private readonly dataDir: string) {}

  private safePath(source: string): string {
    if (!path.isAbsolute(source)) throw new Error('Enter an absolute directory path on the local server.');
    const resolved = path.resolve(source);
    if (path.parse(resolved).root === resolved) throw new Error('Choose a collection folder, not a drive root.');
    for (const protectedPath of [os.homedir(), os.tmpdir(), project, this.dataDir].filter(Boolean)) {
      if (within(resolved, path.resolve(protectedPath))) throw new Error('This directory is a protected application, system or home location. Choose an individual voice collection.');
    }
    for (const protectedPath of [project, this.dataDir, path.join(os.homedir(), '.copilot'), process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((value): value is string => !!value)) {
      if (within(resolved, path.resolve(protectedPath)) || within(path.resolve(protectedPath), resolved))
        throw new Error('Application, system and agent-data directories cannot be sorted. Choose a voice collection outside these directories.');
    }
    return resolved;
  }

  private async validate(source: string): Promise<string> {
    const resolved = this.safePath(source);
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Choose a real directory, not a file, link or junction.');
    if ((await realpath(resolved)).toLowerCase() !== resolved.toLowerCase())
      throw new Error('Directories reached through links or junctions are not supported.');
    return resolved;
  }

  private async validateOutput(output: string, source: string, mode: SortingRequest['mode']): Promise<void> {
    this.safePath(output);
    if (mode === 'replace' && !path.relative(source, output)) return;
    const parent = path.dirname(output);
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(parent)).toLowerCase() !== parent.toLowerCase())
      throw new Error('The output parent must be an existing real directory, not a link or junction.');
    try {
      await lstat(output);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    throw new Error(`Output already exists. Choose a new output folder: ${output}`);
  }

  private async snapshot(source: string): Promise<string> {
    const hash = createHash('sha256');
    const visit = async (directory: string): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        const file = path.join(directory, name);
        const stat = await lstat(file);
        if (stat.isSymbolicLink()) throw new Error(`Links and junctions are not supported: ${file}`);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported filesystem entry: ${file}`);
        hash.update(JSON.stringify([path.relative(source, file), stat.isDirectory(), stat.size, stat.mtimeMs, stat.ino]));
        if (stat.isDirectory()) await visit(file);
      }
    };
    const stat = await lstat(source);
    hash.update(JSON.stringify([stat.ino, stat.birthtimeMs]));
    await visit(source);
    return hash.digest('hex');
  }

  async plan(input: unknown): Promise<SortingPreview> {
    if (this.busy) throw new Error('Folder sorting is already in progress. Wait for it to finish.');
    const { paths, mode, outputDirectory, nameFormat } = sortingRequestSchema.parse(input);
    if (outputDirectory && !path.isAbsolute(outputDirectory)) throw new Error('Enter an absolute output parent directory.');
    if (/[{}]/.test(nameFormat.replace(/\{name\}|\{index\}/g, '')))
      throw new Error('Unknown folder-name placeholder. Use {name} and/or {index}.');
    const normalized = paths.map(source => path.resolve(source));
    for (let i = 0; i < normalized.length; i++) for (let j = 0; j < i; j++)
      if (within(normalized[i], normalized[j]) || within(normalized[j], normalized[i]))
        throw new Error('Directory paths must be unique and must not overlap. Select individual collection folders.');
    const outputs = normalized.map((source, index) => {
      const name = nameFormat.replace(/\{name\}|\{index\}/g, token => token === '{name}' ? path.basename(source) : String(index + 1));
      if (!name || name.length > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
        throw new Error(`Invalid output folder name: ${name}. Use a single valid folder name, not a path.`);
      return path.resolve(outputDirectory || path.dirname(source), name);
    });
    for (let i = 0; i < outputs.length; i++) {
      for (let j = 0; j < normalized.length; j++) {
        if (path.parse(normalized[j]).root === normalized[j]) continue;
        if (i === j && mode === 'replace' && !path.relative(normalized[j], outputs[i])) continue;
        if (within(outputs[i], normalized[j]) || within(normalized[j], outputs[i]))
          throw new Error('Output folders must not overlap any source. Only replace mode may reuse its own exact source path.');
      }
      for (let j = 0; j < i; j++)
        if (within(outputs[i], outputs[j]) || within(outputs[j], outputs[i]))
          throw new Error('Output folder names must be unique and must not overlap. Include {name} or {index} in the format.');
    }
    this.busy = true;
    this.preview = undefined;
    try {
      const response: SortingPreview = { token: randomUUID(), expiresAt: '', mode, entries: [] };
      const snapshots = new Map<string, { snapshot: string; output: string }>();
      for (const [index, source] of paths.entries()) {
        const output = outputs[index];
        try {
          const resolved = await this.validate(source);
          await this.validateOutput(output, resolved, mode);
          const before = await this.snapshot(resolved);
          const plan = sortingPlanSchema.parse(await runSorter('preview', resolved, output, mode));
          if (before !== await this.snapshot(resolved)) throw new Error('Folder contents changed during preview. Preview again before sorting.');
          snapshots.set(resolved, { snapshot: before, output });
          response.entries.push({ source: resolved, output, plan });
        } catch (error) {
          console.error('Folder preview failed:', errorText(error));
          response.entries.push({ source, output, error: errorText(error) });
        }
      }
      response.expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      this.preview = { response, snapshots };
      return response;
    } finally { this.busy = false; }
  }

  async apply(input: unknown): Promise<SortingResults> {
    const { token } = sortingApplySchema.parse(input);
    if (this.busy) throw new Error('Folder sorting is already in progress. Wait for it to finish.');
    const preview = this.preview;
    if (!preview || preview.response.token !== token || Date.parse(preview.response.expiresAt) <= Date.now())
      throw new Error('This preview is missing or expired. Preview the directories again before sorting.');
    if (!preview.snapshots.size) throw new Error('No valid directories are ready to sort. Fix the preview errors first.');
    this.busy = true;
    this.preview = undefined;
    const results: SortingResults = { mode: preview.response.mode, entries: [] };
    try {
      for (const [source, { snapshot, output }] of preview.snapshots) {
        try {
          await this.validate(source);
          await this.validateOutput(output, source, results.mode);
          if (snapshot !== await this.snapshot(source)) throw new Error('Folder contents changed since preview. No sorting was performed; preview again.');
          const result = z.object({ output: z.string() }).parse(await runSorter('apply', source, output, results.mode));
          results.entries.push({ source, output: result.output });
        } catch (error) {
          console.error('Folder sorting failed:', errorText(error));
          results.entries.push({ source, error: errorText(error) });
        }
      }
      return results;
    } finally { this.busy = false; }
  }
}
