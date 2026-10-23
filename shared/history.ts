import { z } from 'zod';
import { evaluationName, summarize, testNameSchema, voiceGenders, type Job, type VoiceGender } from './domain.js';

export const testMetadataSchema = z.object({
  name: testNameSchema,
  voiceLabels: z.array(z.object({
    voice: z.string().trim().min(1).max(200),
    gender: z.enum(voiceGenders),
  }).strict()).max(200),
}).strict().refine(value => new Set(value.voiceLabels.map(label => label.voice)).size === value.voiceLabels.length,
  'Each voice may have only one gender label.');

export type TestHistory = {
  id: string; name: string; createdAt: string; status: Job['status']; stage: Job['profile']['stage'];
  clips: number; voices: string[]; languages: string[]; genders: VoiceGender[];
  bestScore: number | null; bestVoices: { voice: string; role: string }[];
};
export type BulkTestAction = 'delete' | 'redo';
export type BulkTestResult = {
  succeeded: { id: string; newId?: string }[];
  failed: { id: string; error: string }[];
};
export function canManageTest(test: Pick<TestHistory, 'status'>): boolean {
  return test.status !== 'running' && test.status !== 'queued';
}

const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
export function testNameMetadata(name: string): Pick<TestHistory, 'languages' | 'genders'> {
  const tags = [
    ...name.matchAll(/(?<![a-z0-9])([a-z]{2,3}(?:[-_][a-z]{4})?[-_](?:[a-z]{2}|\d{3}))(?![a-z0-9])/gi),
  ].map(match => match[1].replaceAll('_', '-'));
  for (const match of name.matchAll(/(?<![a-zA-Z0-9])([a-z]{2})([A-Z]{2})(?![a-zA-Z0-9])/g))
    tags.push(`${match[1]}-${match[2]}`);
  const languages = [...new Set(tags.map(tag => Intl.getCanonicalLocales(tag)[0])
    .filter(tag => languageNames.of(new Intl.Locale(tag).language)))].sort();
  const found = new Set([...name.matchAll(/(?<![a-z0-9])(female|male|other|unspecified|non[- ]?binary)(?![a-z0-9])/gi)]
    .map(match => /^non/i.test(match[1]) ? 'other' : match[1].toLowerCase()));
  const genders = voiceGenders.filter(gender => found.has(gender.toLowerCase()));
  return { languages, genders: genders.length ? genders : ['Unspecified'] };
}

export function testHistory(job: Job): TestHistory {
  const summaries = summarize(job);
  const scored = summaries.filter(value => value.score !== null);
  const bestScore = scored.length ? Math.max(...scored.map(value => value.score!)) : null;
  const voices = [...new Set(job.clips.map(clip => clip.voice))].sort();
  return {
    id: job.id, name: evaluationName(job), createdAt: job.createdAt, status: job.status,
    stage: job.profile.stage, clips: job.clips.length, voices, ...testNameMetadata(evaluationName(job)),
    bestScore,
    bestVoices: scored.filter(value => bestScore !== null && Math.abs(value.score! - bestScore) < 1e-9)
      .map(value => ({ voice: value.voice, role: value.role })),
  };
}

export const TEST_PAGE_SIZE = 30;
export type TestSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'score-desc' | 'score-asc';
export type TestFilters = {
  search: string; language: string; gender: string; dateFrom: string; dateTo: string; sort: TestSort;
};
export const defaultTestFilters: TestFilters = {
  search: '', language: '', gender: '', dateFrom: '', dateTo: '', sort: 'newest',
};
function localDay(timestamp: string) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function queryTests(entries: TestHistory[], filters: TestFilters, requestedPage: number) {
  const search = filters.search.trim().toLocaleLowerCase();
  const matches = entries.filter(entry => {
    const day = localDay(entry.createdAt);
    return (!search || [entry.name, entry.id, ...entry.voices, ...entry.languages].join('\n').toLocaleLowerCase().includes(search)) &&
      (!filters.language || entry.languages.some(language => language.toLowerCase() === filters.language.toLowerCase())) &&
      (!filters.gender || entry.genders.some(gender => gender === filters.gender)) &&
      (!filters.dateFrom || day >= filters.dateFrom) && (!filters.dateTo || day <= filters.dateTo);
  }).sort((a, b) => {
    let order = 0;
    if (filters.sort === 'name-asc' || filters.sort === 'name-desc')
      order = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * (filters.sort === 'name-asc' ? 1 : -1);
    else if (filters.sort === 'score-asc' || filters.sort === 'score-desc')
      order = a.bestScore === null ? (b.bestScore === null ? 0 : 1) : b.bestScore === null ? -1 :
        (a.bestScore - b.bestScore) * (filters.sort === 'score-asc' ? 1 : -1);
    else order = a.createdAt.localeCompare(b.createdAt) * (filters.sort === 'oldest' ? 1 : -1);
    return order || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(matches.length / TEST_PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, Math.trunc(requestedPage) || 1));
  return { entries: matches.slice((page - 1) * TEST_PAGE_SIZE, page * TEST_PAGE_SIZE), total: matches.length, pages, page };
}
