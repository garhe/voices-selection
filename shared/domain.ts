import { z } from 'zod';

export const RUBRIC_VERSION = 'audio-only-v4';
export const SAMPLE_RATE = 24000;
export const MAX_SECONDS = 120;
export function testType(stage: Profile['stage']): string {
  return stage === 'audition' ? 'Voice Selection' : 'TTS evaluation';
}
export const dimensions = ['naturalness', 'articulation', 'pace', 'expressiveness', 'contextFit', 'accentFit', 'audioQuality'] as const;
export type Dimension = typeof dimensions[number];
export const labels: Record<Dimension, string> = {
  naturalness: 'Naturalness', articulation: 'Articulation', pace: 'Pace & rhythm',
  expressiveness: 'Expressiveness', contextFit: 'Target-style fit', accentFit: 'Target-market accent fit', audioQuality: 'Audio quality',
};
export const voiceDimensionGuidance: Record<Dimension, string> = {
  naturalness: 'Believable, unforced vocal persona: conversational flow, comfortable voice texture and ease of sustained listening. Do not rate whether the wording sounds logical or helpful.',
  articulation: 'Audible speech clarity and effortless listening: clean word boundaries and comfortably intelligible sounds, not simplicity of vocabulary, quality of explanations or script correctness. Do not penalize an accent merely for being different.',
  pace: 'Comfortable vocal rhythm, phrasing, breath flow and pauses without a rushed or dragging feel. Judge listening effort, not how efficiently the script solves a problem; slower is not automatically better.',
  expressiveness: 'Audible emotional color, warmth, engagement and controlled intonation that make the voice agreeable to listen to. Calm or restrained delivery can be excellent; neither maximum emotion nor empathetic wording earns an automatic bonus.',
  contextFit: 'Fit of the audible voice persona, tone and emotional delivery to the supplied vocal style only. Ignore script, factual, logical, business-process and task-completion requirements in the target.',
  accentFit: 'Fit of audible pronunciation, vowel/consonant patterns, stress and intonation to the explicitly supplied target market/accent, allowing its stated regional variation. Judge listener suitability, not personal accent preference, nationality, ethnicity, identity or supposed native-speaker status. Do not infer accent fit from the language hint or script, and do not penalize the same market mismatch again in other dimensions.',
  audioQuality: 'Audible fidelity, noise, distortion, dropouts and synthetic artifacts, not the quality of the spoken content. Its stage-specific rubric weight determines whether it contributes to preference.',
};
export const DEFAULT_TEST_GUIDE = 'This test evaluates the quality of a service agent’s voice in a call center context. You will hear recorded conversations between a customer and an agent or just an agent. If there are 2 people speaking, **Evaluate only the agent’s voice**; if only one people speaking, regardless the role, and compare it with how a natural, authentic voice typically sounds in real-world interactions.  All ratings and comments must focus exclusively on the agent, and your comments should be **as detailed and specific as possible**, describing the agent’s voice quality, naturalness, speaking style, delivery, and any noticeable strengths or issues that influenced your score.';
export const SINGLE_SPEAKER_TEST_GUIDE = 'This test evaluates the quality of a single speaker’s voice in a call center context. You will hear recordings of one speaker. **Evaluate only this speaker’s voice** and compare it with a natural, authentic voice in real-world call center interactions. All ratings and comments must focus exclusively on the recorded speaker, and your comments should be **as detailed and specific as possible**, describing the voice quality, naturalness, speaking style, delivery, and any noticeable strengths or issues that influenced your score.';
export const BOTH_SPEAKERS_TEST_GUIDE = 'This test evaluates the quality of both the agent and customer voices in a call center conversation. **Evaluate the agent and customer separately**, comparing each voice with natural, authentic vocal delivery for that speaker’s role in real-world interactions. For each assessment, **score only the requested speaker’s voice**; do not let the other speaker’s delivery influence the ratings, and do not combine the two speakers into one score. Evaluate audible voice quality, naturalness, speaking style and delivery, not script content or service performance. Keep ratings and comments specific to the assessed speaker, with **detailed, recording-specific observations** about strengths or issues that influenced the score.';
export const rubricDimensionSchema = z.object({
  id: z.enum(dimensions),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
  enabled: z.boolean(),
  weights: z.object({ audition: z.number().finite().min(0).max(1000), tts: z.number().finite().min(0).max(1000) }).strict(),
}).strict();
export const rubricContentSchema = z.object({
  name: z.string().trim().min(1, 'Enter a rubric name.').max(80),
  instructions: z.string().trim().min(1, 'Enter evaluation instructions.').max(6000),
  testGuides: z.object({
    conversation: z.string().trim().min(1).max(1500),
    single: z.string().trim().min(1).max(1500),
    both: z.string().trim().min(1).max(1500).default(BOTH_SPEAKERS_TEST_GUIDE),
  }).strict(),
  dimensions: z.array(rubricDimensionSchema).length(dimensions.length),
}).strict();
export const rubricSchema = rubricContentSchema.extend({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  revision: z.number().int().positive(),
}).superRefine((rubric, ctx) => {
  if (new Set(rubric.dimensions.map(d => d.id)).size !== dimensions.length)
    ctx.addIssue({ code: 'custom', path: ['dimensions'], message: 'Include each of the seven scoring dimensions exactly once.' });
  if (new Set(rubric.dimensions.map(d => d.label.toLowerCase())).size !== dimensions.length)
    ctx.addIssue({ code: 'custom', path: ['dimensions'], message: 'Dimension labels must be unique.' });
  for (const stage of ['audition', 'tts'] as const)
    if (!rubric.dimensions.some(d => d.enabled && d.weights[stage] > 0))
      ctx.addIssue({ code: 'custom', path: ['dimensions'], message: `Enable at least one positive-weight dimension for ${stage}.` });
});
export type Rubric = z.infer<typeof rubricSchema>;
export const DEFAULT_RUBRIC: Rubric = {
  id: RUBRIC_VERSION, revision: 1, name: 'Default voice-persona rubric',
  instructions: 'Evaluate audible vocal delivery, not script quality or task completion. Assess voice persona, tone, timbre, emotional delivery and ease of listening. Give detailed, recording-specific reasons in English. Use 1 very poor, 2 poor, 3 fair, 4 good and 5 excellent; fractions are allowed. Use null with a specific explanation when audible evidence is insufficient; never guess.',
  testGuides: { conversation: DEFAULT_TEST_GUIDE, single: SINGLE_SPEAKER_TEST_GUIDE, both: BOTH_SPEAKERS_TEST_GUIDE },
  dimensions: dimensions.map(id => ({
    id, label: labels[id], description: voiceDimensionGuidance[id], enabled: true,
    weights: { audition: id === 'audioQuality' ? 0 : 1, tts: 1 },
  })),
};
export const judgeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  deployment: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),
});
export const settingsSchema = z.object({
  judges: z.array(judgeSchema).min(1),
}).superRefine((value, ctx) => {
  if (new Set(value.judges.map(j => j.id)).size !== value.judges.length)
    ctx.addIssue({ code: 'custom', message: 'Judge IDs must be unique.' });
});
export type Settings = z.infer<typeof settingsSchema>;
export type Judge = z.infer<typeof judgeSchema>;
export type ConnectionStatus = {
  configured: boolean; endpoint: string; keyStored: boolean;
  connectionSource: 'saved' | 'environment' | 'none'; secureStorageAvailable: boolean;
};
export type ConnectionTest = { judgeId: string; ok: boolean; model?: string; error?: string };
export const languageHintSchema = z.string().trim().min(1, 'Enter a language/accent target or use Auto.').max(500, 'Use at most 500 characters for the language/accent target.');
export const profileSchema = z.object({
  stage: z.enum(['audition', 'tts']),
  scope: z.enum(['single', 'agent', 'customer', 'both']),
  speakerMode: z.enum(['automatic', 'manual']).optional(),
  singleSpeakerFallback: z.boolean().optional(),
  target: z.string().trim().min(1, 'Enter a target vocal style or test guide before starting the evaluation.').max(1500),
  language: languageHintSchema,
  targetMarket: z.string().trim().max(500).optional(),
  rubric: rubricSchema.optional(),
}).superRefine((profile, ctx) => {
  if (profile.rubric && !profile.rubric.dimensions.some(d => d.enabled && d.weights[profile.stage] > 0 &&
      (d.id !== 'contextFit' || !!profile.target) && (d.id !== 'accentFit' || !!profile.targetMarket?.trim())))
    ctx.addIssue({ code: 'custom', path: ['rubric', 'dimensions'], message: 'The rubric has no weighted dimensions active for this stage and target. Enable a dimension or supply its required target.' });
});
export type Profile = z.infer<typeof profileSchema>;
export function mediaText(text: string, stage: Profile['stage']): string {
  if (stage !== 'tts') return text;
  return text.replace(/\brecordings?\b/gi, word => {
    const audio = word.toLowerCase().endsWith('s') ? 'audio files' : 'audio';
    return word[0] === 'R' ? audio[0].toUpperCase() + audio.slice(1) : audio;
  });
}
export function profileRubric(profile: Pick<Profile, 'rubric'>): Rubric {
  return profile.rubric ?? DEFAULT_RUBRIC;
}
export function dimensionLabel(profile: Pick<Profile, 'rubric'>, dimension: Dimension): string {
  return profileRubric(profile).dimensions.find(d => d.id === dimension)!.label;
}
export function dimensionGuidance(profile: Pick<Profile, 'rubric'>, dimension: Dimension): string {
  return profileRubric(profile).dimensions.find(d => d.id === dimension)!.description;
}
export function dimensionWeight(profile: Pick<Profile, 'rubric' | 'stage'>, dimension: Dimension): number {
  const config = profileRubric(profile).dimensions.find(d => d.id === dimension)!;
  return config.enabled ? config.weights[profile.stage] : 0;
}
export function resolveLanguageHint(recordingHint: string, evaluationHint: string): string {
  const hint = languageHintSchema.parse(recordingHint);
  return hint.toLowerCase() === 'auto' ? languageHintSchema.parse(evaluationHint) : hint;
}
export const clipSchema = z.object({
  id: z.string().uuid(),
  voice: z.string().trim().min(1).max(200),
  file: z.string().min(1).max(500),
  role: z.enum(['speaker', 'agent', 'customer']),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  channel: z.enum(['mix', 'left', 'right']),
  language: languageHintSchema,
}).refine(c => c.end > c.start && c.end - c.start <= MAX_SECONDS + 0.001, {
  message: `Select a region longer than 0 and no longer than ${MAX_SECONDS} seconds.`,
});
export type Clip = z.infer<typeof clipSchema>;
export function rolesForScope(scope: Profile['scope']): Clip['role'][] {
  return scope === 'single' ? ['speaker'] : scope === 'both' ? ['agent', 'customer'] : [scope];
}
export type Technical = { peakDb: number | null; rmsDb: number | null; clippingPercent: number; quietPercent: number; seconds: number };
export type StoredClip = Clip & { technical: Technical };
export type DraftClip = StoredClip & { include: boolean };
export function clipScopeError(scope: Profile['scope'], clips: Clip[]): string | undefined {
  const wanted = rolesForScope(scope);
  if (clips.some(c => !wanted.includes(c.role))) return 'Selected excerpts do not match the speaker scope.';
  const files = new Set(clips.map(c => JSON.stringify([c.voice, c.file])));
  for (const file of files) {
    const selected = clips.filter(c => JSON.stringify([c.voice, c.file]) === file);
    if (wanted.some(role => !selected.some(c => c.role === role)))
      return 'Every recording needs a confirmed region for each selected role.';
    for (const role of wanted) {
      const regions = selected.filter(c => c.role === role).sort((a, b) => a.start - b.start);
      if (regions.some((c, i) => i > 0 && c.start < regions[i - 1].end))
        return 'Regions for the same role must not overlap; this would double-count speech.';
    }
  }
}
export const rehearsalCaseSchema = z.object({
  dimension: z.enum(dimensions),
  cue: z.string().trim().min(1).max(300),
  observation: z.string().trim().min(1).max(600),
  direction: z.string().trim().min(1).max(600),
  check: z.string().trim().min(1).max(400),
}).strict();
export const assessmentSchema = z.object({
  language: z.string().min(1).max(100),
  languageSupported: z.boolean(),
  assessable: z.boolean(),
  speakerAttribution: z.object({
    role: z.enum(['speaker', 'agent', 'customer']),
    status: z.enum(['identified', 'not_present', 'uncertain', 'single_speaker_fallback']),
    singleSpeaker: z.boolean().optional(),
    evidence: z.string().trim().min(1).max(1500),
  }).strict().optional(),
  scores: z.object({
    naturalness: z.number().min(1).max(5).nullable(),
    articulation: z.number().min(1).max(5).nullable(),
    pace: z.number().min(1).max(5).nullable(),
    expressiveness: z.number().min(1).max(5).nullable(),
    contextFit: z.number().min(1).max(5).nullable(),
    accentFit: z.number().min(1).max(5).nullable(),
    audioQuality: z.number().min(1).max(5).nullable(),
  }).strict(),
  reasons: z.object({
    naturalness: z.string().max(1200), articulation: z.string().max(1200),
    pace: z.string().max(1200), expressiveness: z.string().max(1200),
    contextFit: z.string().max(1200), accentFit: z.string().max(1200), audioQuality: z.string().max(1200),
  }).strict(),
  observations: z.array(z.string().max(1500)).max(12),
  limitations: z.array(z.string().max(1500)).max(12),
  rehearsalCases: z.array(rehearsalCaseSchema).max(3).optional(),
}).strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type AssessmentResponseFormat = 'function_call' | 'function_call_with_preamble' | 'json_text' | 'wrapped_json_text';
export type AudioResponseDiagnostic = {
  inputAudioTokens?: number; inputTextTokens?: number; outputTokens?: number;
  outputTypes: string[];
  outcome: 'accepted' | 'invalid_format' | 'incomplete' | 'missing_audio_claim' | 'zero_audio_tokens';
};
export type AudioDiagnostics = {
  inputBytes: number; inputSha256: string;
  recovery: 'not_needed' | 'recovered' | 'unresolved';
  sessions: {
    uploadedBytes: number; committed: boolean; model?: string; error?: string;
    responses: AudioResponseDiagnostic[];
  }[];
};
export type JudgeEvaluation = {
  status: TaskStatus;
  assessment?: Assessment; error?: string; model?: string; responseFormat?: AssessmentResponseFormat;
  audioDiagnostics?: AudioDiagnostics;
};
export type JudgeResult = JudgeEvaluation & {
  clipId: string; judgeId: string;
  previousEvaluations?: (JudgeEvaluation & { retriedAt: string })[];
};
export const testNameSchema = z.string().trim().min(1, 'Enter a test name.').max(120, 'Use at most 120 characters for the test name.');
export const voiceGenders = ['Female', 'Male', 'Other', 'Unspecified'] as const;
export type VoiceGender = typeof voiceGenders[number];
export type VoiceLabel = { voice: string; gender: VoiceGender };
export type Job = {
  id: string; name?: string; createdAt: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'interrupted';
  profile: Profile; judges: Judge[]; clips: StoredClip[]; results: JudgeResult[];
  rubric: string;
  voiceLabels?: VoiceLabel[];
  queueOrder?: number;
  retrySelection?: { clipId: string; judgeId: string }[];
};
export type TestQueueState = {
  paused: boolean; active?: { id: string; name: string; retry?: boolean };
  waiting: { id: string; name: string; retry?: boolean }[]; error?: string;
};
export function evaluationName(value: { name?: string }): string {
  return value.name?.trim() || 'Untitled evaluation';
}

export function activeDimensions(profile: Profile): Dimension[] {
  return dimensions.filter(d => dimensionWeight(profile, d) > 0 &&
    (d !== 'contextFit' || !!profile.target) && (d !== 'accentFit' || !!profile.targetMarket?.trim()));
}
export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
export function hasScoringSpeaker(assessment: Assessment, profile: Profile, role?: Clip['role']): boolean {
  if (profile.speakerMode !== 'automatic') return assessment.speakerAttribution?.status !== 'single_speaker_fallback';
  const attribution = assessment.speakerAttribution;
  if (!attribution || (role && attribution.role !== role)) return false;
  return attribution.status === 'identified' || (attribution.status === 'single_speaker_fallback' &&
    profile.singleSpeakerFallback === true && ['agent', 'both'].includes(profile.scope) &&
    attribution.role === 'agent' && attribution.singleSpeaker === true);
}
export function singleSpeakerFallbackCount(job: Pick<Job, 'results'>): number {
  return job.results.filter(result => result.status === 'completed' && result.assessment?.speakerAttribution?.status === 'single_speaker_fallback').length;
}
export function eligibleScore(assessment: Assessment, profile: Profile): number | null {
  if (!hasScoringSpeaker(assessment, profile)) return null;
  if (!assessment.assessable || !assessment.languageSupported) return null;
  const active = activeDimensions(profile);
  const scores = active.map(d => assessment.scores[d]);
  if (!active.length) return null;
  if (!scores.every((s): s is number => typeof s === 'number' && Number.isFinite(s))) return null;
  const totalWeight = active.reduce((sum, d) => sum + dimensionWeight(profile, d), 0);
  return active.reduce((sum, d, index) => sum + scores[index] * dimensionWeight(profile, d), 0) / totalWeight;
}
export function claimsMissingAudio(assessment: Assessment): boolean {
  if (assessment.assessable && assessment.languageSupported) return false;
  if (assessment.speakerAttribution?.status === 'not_present') return false;
  const text = [...assessment.limitations, ...Object.values(assessment.reasons), assessment.speakerAttribution?.evidence ?? ''].join('\n');
  return [
    /\bno (?:actual |original |input |audible )?(?:audio|recording)(?: content| recording| signal)? (?:was |is |has been )?(?:provided|included|presented|available|supplied)\b/i,
    /\bwithout (?:the |an? )?(?:actual |original |accompanying |any )?(?:audio|audible (?:recording|signal))\b/i,
    /\b(?:audio|audible (?:recording|signal)) (?:was |is )?(?:not (?:audibly )?(?:provided|included|available|presented)|missing|absent)\b/i,
    /\b(?:lack|absence) of (?:actual |audible |original )?audio(?: content| input| recording| signal)?\b/i,
    /\bnon-audio representation\b/i,
    /\b(?:cannot|can't|unable to) (?:access|hear|listen to) (?:the |any |actual |original )?audio\b/i,
  ].some(pattern => pattern.test(text));
}
export function retryableAudioIssue(result: JudgeResult): boolean {
  return result.status === 'completed' && !!result.assessment && claimsMissingAudio(result.assessment);
}
export function normalizeAssessment(value: unknown, profile: Profile, role?: Clip['role']): Assessment {
  const assessment = assessmentSchema.parse(value);
  if (assessment.speakerAttribution?.status === 'single_speaker_fallback' &&
      (!hasScoringSpeaker(assessment, profile, role) || !assessment.assessable || !assessment.languageSupported))
    throw new Error('Single-speaker fallback requires an enabled automatic agent evaluation, exactly one confirmed speaker and assessable supported-language speech.');
  if (profile.speakerMode === 'automatic') {
    if (!role || !assessment.speakerAttribution || assessment.speakerAttribution.role !== role)
      throw new Error('Automatic role evaluation requires attribution for the requested speaker role.');
    if (!hasScoringSpeaker(assessment, profile, role)) {
      assessment.assessable = false;
      for (const d of dimensions) {
        assessment.scores[d] = null;
        assessment.reasons[d] = `Not scored: role ${assessment.speakerAttribution.status}. ${assessment.speakerAttribution.evidence}`;
      }
    }
  }
  if (!profile.target) {
    assessment.scores.contextFit = null;
    assessment.reasons.contextFit = 'Not assessed: no target style was supplied.';
  }
  if (!profile.targetMarket?.trim()) {
    assessment.scores.accentFit = null;
    assessment.reasons.accentFit = 'Not assessed: no target market/accent was supplied.';
  }
  for (const d of dimensions) if (d !== 'audioQuality' && dimensionWeight(profile, d) === 0) {
    assessment.scores[d] = null;
    assessment.reasons[d] = `Not scored: ${dimensionLabel(profile, d)} is excluded or has zero weight in this rubric and stage.`;
  }
  if (!assessment.assessable || !assessment.languageSupported) {
    for (const d of dimensions) if (d !== 'audioQuality') assessment.scores[d] = null;
  }
  if (assessment.rehearsalCases) assessment.rehearsalCases = assessment.rehearsalCases.filter(item =>
    assessment.assessable && assessment.languageSupported &&
    activeDimensions(profile).includes(item.dimension) && assessment.scores[item.dimension] !== null);
  return assessment;
}

export type Summary = {
  voice: string; role: string; files: number; eligibleFiles: number;
  score: number | null; min: number | null; max: number | null;
  dimensions: Record<Dimension, number | null>; disagreement: number | null; languages: string[];
  absentWindows: number;
};
export function compareVoiceScores(a: Pick<Summary, 'score' | 'dimensions'>, b: Pick<Summary, 'score' | 'dimensions'>): number {
  if (a.score === null || b.score === null) return a.score === b.score ? 0 : a.score === null ? 1 : -1;
  const overall = b.score - a.score;
  if (Math.abs(overall) >= 1e-9) return overall;
  const left = a.dimensions.naturalness, right = b.dimensions.naturalness;
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const naturalness = right - left;
  return Math.abs(naturalness) < 1e-9 ? 0 : naturalness;
}
export function summarize(job: Job): Summary[] {
  const groups = new Map<string, StoredClip[]>();
  for (const c of job.clips) {
    const key = JSON.stringify([c.voice, c.role]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].map(clips => {
    const fileGroups = new Map<string, StoredClip[]>();
    for (const c of clips) fileGroups.set(c.file, [...(fileGroups.get(c.file) ?? []), c]);
    const dimensionFiles: Record<Dimension, number[]> = {
      naturalness: [], articulation: [], pace: [], expressiveness: [], contextFit: [], accentFit: [], audioQuality: [],
    };
    const fileScores: number[] = [];
    const spreads: number[] = [];
    const languages = new Set<string>();
    let absentWindows = 0;
    for (const fileClips of fileGroups.values()) {
      let requiredRegions = fileClips.length;
      const regionScores: { score: number; seconds: number }[] = [];
      const dimensionRegions: Record<Dimension, { score: number; seconds: number }[]> = {
        naturalness: [], articulation: [], pace: [], expressiveness: [], contextFit: [], accentFit: [], audioQuality: [],
      };
      for (const c of fileClips) {
        const results = job.results.filter(r => r.clipId === c.id && r.status === 'completed' && r.assessment);
        for (const r of results) if (r.assessment) languages.add(r.assessment.language);
        // A consensus requires the complete configured panel, not just whichever judges succeeded.
        if (results.length !== job.judges.length) continue;
        if (job.profile.speakerMode === 'automatic' && results.every(r =>
          r.assessment!.languageSupported && r.assessment!.speakerAttribution?.role === c.role &&
          r.assessment!.speakerAttribution.status === 'not_present')) {
          absentWindows++; requiredRegions--; continue;
        }
        const scores = results.map(r => hasScoringSpeaker(r.assessment!, job.profile, c.role) ? eligibleScore(r.assessment!, job.profile) : null);
        const seconds = c.end - c.start;
        if (scores.every((s): s is number => s !== null)) {
          regionScores.push({ score: mean(scores)!, seconds });
          spreads.push(Math.max(...scores) - Math.min(...scores));
        }
        for (const d of dimensions) {
          const values = results.map(r => {
            const a = r.assessment!;
            return d === 'audioQuality' || (a.assessable && a.languageSupported) ? a.scores[d] : null;
          });
          if (values.every((s): s is number => typeof s === 'number' && Number.isFinite(s)))
            dimensionRegions[d].push({ score: mean(values)!, seconds });
        }
      }
      const weighted = (values: { score: number; seconds: number }[]) =>
        values.reduce((total, v) => total + v.score * v.seconds, 0) / values.reduce((total, v) => total + v.seconds, 0);
      // Every selected region must be eligible before its recording enters the overall average.
      if (requiredRegions > 0 && regionScores.length === requiredRegions) fileScores.push(weighted(regionScores));
      for (const d of dimensions) if (requiredRegions > 0 && dimensionRegions[d].length === requiredRegions)
        dimensionFiles[d].push(weighted(dimensionRegions[d]));
    }
    return {
      voice: clips[0].voice, role: clips[0].role, files: fileGroups.size, eligibleFiles: fileScores.length,
      score: mean(fileScores), min: fileScores.length ? Math.min(...fileScores) : null,
      max: fileScores.length ? Math.max(...fileScores) : null,
      dimensions: Object.fromEntries(dimensions.map(d => [d, mean(dimensionFiles[d])])) as Summary['dimensions'],
      disagreement: mean(spreads), languages: [...languages], absentWindows,
    };
  }).sort((a, b) => compareVoiceScores(a, b) || a.voice.localeCompare(b.voice, 'en') || a.role.localeCompare(b.role, 'en'));
}

export function assessmentGaps(result: JudgeResult | undefined, profile: Profile, role: Clip['role']): string[] {
  if (!result) return ['Assessment is missing.'];
  if (result.status !== 'completed') return [`Assessment ${result.status}${result.error ? `: ${result.error}` : '.'}`];
  const a = result.assessment;
  if (!a) return ['Completed response contains no assessment.'];
  const gaps: string[] = [];
  if (claimsMissingAudio(a)) {
    const audioTokens = result.audioDiagnostics?.sessions.at(-1)?.responses.at(-1)?.inputAudioTokens;
    gaps.push(audioTokens !== undefined && audioTokens > 0
      ? `Suspected judge audio-access misreport: Azure counted ${audioTokens} input audio tokens, but the judge claimed audio was missing. Scores remain withheld.`
      : 'Suspected missing-audio claim. Audio-token receipt is not confirmed; retry this input with audio-delivery diagnostics.');
  }
  if (!hasScoringSpeaker(a, profile, role))
    gaps.push(`Requested ${role} role ${a.speakerAttribution?.status ?? 'not attributed'}: ${a.speakerAttribution?.evidence ?? 'Role evidence is missing.'}`);
  if (!a.languageSupported) gaps.push(`The judge could not reliably assess the audio language (${a.language}).`);
  if (!a.assessable) gaps.push('The judge reported insufficient assessable target speech.');
  if (!gaps.length) for (const d of activeDimensions(profile)) if (typeof a.scores[d] !== 'number')
    gaps.push(`${dimensionLabel(profile, d)} rating missing${d === 'contextFit' && profile.target ? ' (the test supplied a target)' : d === 'accentFit' && profile.targetMarket?.trim() ? ' (the test supplied a target market/accent)' : ''}: ${a.reasons[d] || 'No reason was provided.'}`);
  return gaps;
}

export type EvidenceNote = { text: string; files: string[] };
export function unassessedInputs(job: Job) {
  return job.clips.flatMap(clip => {
    const judges = job.judges.flatMap(judge => {
      const result = job.results.find(result => result.clipId === clip.id && result.judgeId === judge.id);
      const gaps = assessmentGaps(result, job.profile, clip.role);
      return gaps.length ? [{ judge, result, gaps }] : [];
    });
    return judges.length ? [{ clip, judges }] : [];
  });
}

export type VoiceEvidence = {
  voice: string; role: string; files: number; eligibleFiles: number; score: number | null;
  judges: {
    judgeId: string; scoredFiles: number; score: number | null;
    gaps: EvidenceNote[]; observations: EvidenceNote[]; limitations: EvidenceNote[];
    dimensions: { dimension: Dimension; score: number | null; diagnostic: boolean; reasons: EvidenceNote[] }[];
  }[];
};
export function summarizeVoiceEvidence(job: Job): VoiceEvidence[] {
  const notes = (values: { text: string; file: string }[]): EvidenceNote[] => {
    const grouped = new Map<string, Set<string>>();
    for (const value of values) {
      const text = value.text.trim().replace(/\s+/g, ' ');
      if (text) {
        if (!grouped.has(text)) grouped.set(text, new Set());
        grouped.get(text)!.add(value.file);
      }
    }
    return [...grouped].map(([text, files]) => ({ text, files: [...files].sort() }))
      .sort((a, b) => b.files.length - a.files.length || a.text.localeCompare(b.text, 'en'));
  };
  return summarize(job).map(summary => {
    const clips = job.clips.filter(c => c.voice === summary.voice && c.role === summary.role);
    return {
      voice: summary.voice, role: summary.role, files: summary.files, eligibleFiles: summary.eligibleFiles, score: summary.score,
      judges: job.judges.map(judge => {
        const entries = clips.map(clip => ({ clip, result: job.results.find(r => r.clipId === clip.id && r.judgeId === judge.id) }));
        const completed = entries.filter(entry => entry.result?.status === 'completed' && entry.result.assessment);
        const own = summarize({ ...job, clips, judges: [judge], results: job.results.filter(r => r.judgeId === judge.id) })[0];
        return {
          judgeId: judge.id, scoredFiles: own.eligibleFiles, score: own.score,
          gaps: notes(entries.flatMap(({ clip, result }) => assessmentGaps(result, job.profile, clip.role).map(text => ({ text, file: clip.file })))),
          observations: notes(completed.flatMap(({ clip, result }) => result!.assessment!.observations.map(text => ({ text, file: clip.file })))),
          limitations: notes(completed.flatMap(({ clip, result }) => result!.assessment!.limitations.map(text => ({ text, file: clip.file })))),
          dimensions: dimensions.filter(d => activeDimensions(job.profile).includes(d) || d === 'audioQuality').map(d => ({
            dimension: d, score: own.dimensions[d], diagnostic: d === 'audioQuality' && !activeDimensions(job.profile).includes(d),
            reasons: notes(completed.flatMap(({ clip, result }) => {
              const a = result!.assessment!;
              const identified = hasScoringSpeaker(a, job.profile, clip.role);
              return identified && a.scores[d] !== null && (d === 'audioQuality' || (a.assessable && a.languageSupported))
                ? [{ text: a.reasons[d], file: clip.file }] : [];
            })),
          })),
        };
      }),
    };
  });
}
