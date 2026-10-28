import { testHistory, testNameMetadata, type TestHistory } from '../shared/history';
import type { Job } from '../shared/domain';

export function createHistoryLoader(
  loadList: (signal?: AbortSignal) => Promise<TestHistory[]>,
  loadJob: (id: string, signal?: AbortSignal) => Promise<Job>,
) {
  const cache = new Map<string, { signature: string; incomplete: boolean }>();
  let generation = 0;
  return async (signal?: AbortSignal, refresh = false): Promise<TestHistory[]> => {
    if (refresh) { cache.clear(); generation++; }
    const currentGeneration = generation;
    const entries = await loadList(signal);
    if (entries.some(entry => !Array.isArray(entry.languages) || !Array.isArray(entry.voices) || !Array.isArray(entry.genders)))
      throw new Error('The server is using an older test-list format. Restart Voices Selection, then refresh this page.');
    const completed = new Set(entries.filter(entry => entry.status === 'completed' && typeof entry.incomplete !== 'boolean').map(entry => entry.id));
    for (const id of cache.keys()) if (!completed.has(id)) cache.delete(id);
    const resolved = new Array<TestHistory>(entries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (next < entries.length) {
        signal?.throwIfAborted();
        const index = next++;
        const entry = entries[index];
        const normalized = { ...entry, ...testNameMetadata(entry.name) };
        if (!completed.has(entry.id)) {
          resolved[index] = normalized;
          continue;
        }
        const signature = JSON.stringify(entry);
        const saved = cache.get(entry.id);
        if (saved?.signature === signature) {
          resolved[index] = { ...normalized, incomplete: saved.incomplete };
          continue;
        }
        const job = await loadJob(entry.id, signal);
        signal?.throwIfAborted();
        const summary = testHistory(job);
        if (currentGeneration === generation && summary.status === 'completed')
          cache.set(entry.id, { signature, incomplete: summary.incomplete === true });
        resolved[index] = summary;
      }
    }));
    return resolved;
  };
}
