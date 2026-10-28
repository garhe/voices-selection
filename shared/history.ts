import { z } from 'zod';
import { evaluationName, summarize, summarizeVoiceEvidence, testNameSchema, testType, unassessedInputs, singleSpeakerFallbackCount, voiceGenders, type Job, type VoiceGender } from './domain.js';
import { csvCell } from './csv.js';

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
  incomplete?: boolean;
};
export function testStatusLabel(test: Pick<TestHistory, 'status' | 'incomplete'>): string {
  return test.status === 'completed' && test.incomplete ? 'Completed*' : test.status[0].toUpperCase() + test.status.slice(1);
}
export type BulkTestAction = 'delete' | 'redo';
export type BulkTestResult = {
  succeeded: { id: string; newId?: string }[];
  failed: { id: string; error: string }[];
};
export function canManageTest(test: Pick<TestHistory, 'status'>): boolean {
  return test.status !== 'running' && test.status !== 'queued';
}
export function canRetryUnassessedTest(test: Pick<TestHistory, 'status' | 'incomplete'>): boolean {
  return test.status === 'completed' && test.incomplete === true;
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
  const found = new Set([...name.matchAll(/(?<![a-z0-9])(female|male|f|m|other|unspecified|non[- ]?binary)(?![a-z0-9])/gi)]
    .map(match => /^non/i.test(match[1]) ? 'other' : /^f$/i.test(match[1]) ? 'female' : /^m$/i.test(match[1]) ? 'male' : match[1].toLowerCase()));
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
    incomplete: job.status === 'completed' && unassessedInputs(job).length > 0,
    stage: job.profile.stage, clips: job.clips.length, voices, ...testNameMetadata(evaluationName(job)),
    bestScore,
    bestVoices: scored.filter(value => bestScore !== null && Math.abs(value.score! - bestScore) < 1e-9)
      .map(value => ({ voice: value.voice, role: value.role })),
  };
}

export const TEST_PAGE_SIZE = 30;
export const TEST_PAGE_SIZES = [30, 40, 50] as const;
export function testTableCsv(jobs: Job[]): string {
  const judgeColumns = new Map<string, string>();
  const reports = jobs.map(job => {
    const occurrences = new Map<string, number>();
    const judges = new Map(job.judges.map(judge => {
      const identity = JSON.stringify([judge.name, judge.deployment]);
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      const key = JSON.stringify([judge.name, judge.deployment, occurrence]);
      judgeColumns.set(key, `${judge.name} (${judge.deployment})${occurrence > 1 ? ` #${occurrence}` : ''}`);
      return [key, judge.id];
    }));
    const voices = summarizeVoiceEvidence(job).sort((a, b) =>
      a.score === null ? (b.score === null ? a.voice.localeCompare(b.voice) || a.role.localeCompare(b.role) : 1) :
        b.score === null ? -1 : b.score - a.score || a.voice.localeCompare(b.voice) || a.role.localeCompare(b.role));
    const bestScore = voices.find(voice => voice.score !== null)?.score ?? null;
    const isBest = (voice: typeof voices[number]) =>
      voice.score !== null && bestScore !== null && Math.abs(voice.score - bestScore) < 1e-9;
    return { job, judges, best: voices.filter(isBest), other: voices.filter(voice => !isBest(voice)) };
  });
  const bestCount = Math.max(1, ...reports.map(report => report.best.length));
  const otherCount = Math.max(0, ...reports.map(report => report.other.length));
  const groups = [
    ...Array.from({ length: bestCount }, (_, index) => ({ kind: 'best' as const, index, label: bestCount === 1 ? 'Best voice' : `Best voice ${index + 1}` })),
    ...Array.from({ length: otherCount }, (_, index) => ({ kind: 'other' as const, index, label: `Other voice ${index + 1}` })),
  ];
  const includeFallback = jobs.some(job => singleSpeakerFallbackCount(job) > 0);
  const rows = [
    ['Test name', 'Test time', 'Test type', 'Locale', 'Gender', ...groups.flatMap(({ label }) => [
      `${label} name`, `${label} overall score`,
      ...[...judgeColumns.values()].map(judge => `${label} - ${judge} average score`),
    ]), ...(includeFallback ? ['Single-speaker fallback assessments'] : [])],
    ...reports.map(report => {
      const metadata = testNameMetadata(evaluationName(report.job));
      return [
        evaluationName(report.job), report.job.createdAt, testType(report.job.profile.stage), metadata.languages.join(', ') || 'Not specified', metadata.genders.join(', ') || 'Unspecified',
        ...groups.flatMap(({ kind, index }) => {
          const voice = report[kind][index];
          if (!voice) return ['', kind === 'best' && index === 0 && !report.best.length ? 'Not assessed' : '', ...[...judgeColumns].map(() => '')];
          return [
            voice.voice, voice.score === null ? 'Not assessed' : voice.score.toFixed(2),
            ...[...judgeColumns.keys()].map(key => {
              const judgeId = report.judges.get(key);
              if (!judgeId) return '';
              const score = voice.judges.find(judge => judge.judgeId === judgeId)?.score;
              return score == null ? 'Not assessed' : score.toFixed(2);
            }), ...(includeFallback ? [singleSpeakerFallbackCount(report.job)] : []),
          ];
        }),
      ];
    }),
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export type TestSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'score-desc' | 'score-asc';
export const TEST_STATUS_FILTERS = ['completed', 'incomplete', 'running', 'queued', 'cancelled', 'interrupted'] as const;
export type TestFilters = {
  search: string; language: string; gender: string; dateFrom: string; dateTo: string; sort: TestSort;
  status: '' | typeof TEST_STATUS_FILTERS[number];
};
export const defaultTestFilters: TestFilters = {
  search: '', language: '', gender: '', dateFrom: '', dateTo: '', sort: 'newest', status: '',
};
function localDay(timestamp: string) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function queryTests(entries: TestHistory[], filters: TestFilters, requestedPage: number, pageSize = TEST_PAGE_SIZE) {
  if (!TEST_PAGE_SIZES.some(size => size === pageSize)) throw new Error('Choose 30, 40 or 50 tests per page.');
  const search = filters.search.trim().toLocaleLowerCase();
  const matches = entries.filter(entry => {
    const day = localDay(entry.createdAt);
    return (!search || [entry.name, entry.id, ...entry.voices, ...entry.languages].join('\n').toLocaleLowerCase().includes(search)) &&
      (!filters.language || entry.languages.some(language => language.toLowerCase() === filters.language.toLowerCase())) &&
      (!filters.gender || entry.genders.some(gender => gender === filters.gender)) &&
      (!filters.status || (filters.status === 'incomplete'
        ? entry.status === 'completed' && entry.incomplete === true
        : entry.status === filters.status && (filters.status !== 'completed' || !entry.incomplete))) &&
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
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.max(1, Math.min(pages, Math.trunc(requestedPage) || 1));
  return { entries: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, pages, page };
}
