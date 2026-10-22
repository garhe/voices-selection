import { access, mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type Job, type Settings, type StoredClip } from '../shared/domain.js';

export class Store {
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly root: string, private readonly renameFile: typeof rename = rename) {}
  async init() {
    await mkdir(path.join(this.root, 'jobs'), { recursive: true });
    await mkdir(path.join(this.root, 'clips'), { recursive: true });
  }
  async read<T>(relative: string): Promise<T> {
    return JSON.parse(await readFile(path.join(this.root, relative), 'utf8')) as T;
  }
  async exists(relative: string) {
    try { await readFile(path.join(this.root, relative)); return true; }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async save(relative: string, value: unknown) {
    const json = JSON.stringify(value, null, 2);
    const write = this.writes.then(async () => {
      const destination = path.join(this.root, relative);
      const temporary = `${destination}.tmp`;
      await writeFile(temporary, json, { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await this.renameFile(temporary, destination); break; }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) ||
            !['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)) || attempt >= 6) throw error;
          console.warn(`Atomic save temporarily blocked (${error.code}); retrying local rename ${attempt + 1}/6.`);
          await delay(Math.min(50 * 2 ** attempt, 1000));
        }
      }
    });
    this.writes = write.catch(error => { console.error('Persistence write failed:', error.message); });
    return write;
  }
  async jobs(): Promise<Job[]> {
    const names = (await readdir(path.join(this.root, 'jobs'))).filter(n => n.endsWith('.json'));
    const jobs = await Promise.all(names.map(n => this.read<Job>(path.join('jobs', n))));
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  saveJob(job: Job) { return this.save(path.join('jobs', `${job.id}.json`), job); }
  settings() { return this.read<Settings>('settings.json'); }
  remove(relative: string) { return unlink(path.join(this.root, relative)); }
  clip(id: string) { return this.read<StoredClip>(path.join('clips', `${id}.json`)); }
  pcm(id: string) { return readFile(path.join(this.root, 'clips', `${id}.pcm`)); }
  async hasPcm(id: string) {
    try { await access(path.join(this.root, 'clips', `${id}.pcm`)); return true; }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async saveClip(clip: StoredClip, pcm: Buffer) {
    await writeFile(path.join(this.root, 'clips', `${clip.id}.pcm`), pcm, { flag: 'wx', mode: 0o600 });
    await this.save(path.join('clips', `${clip.id}.json`), clip);
  }
}
