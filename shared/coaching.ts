import {
  activeDimensions, summarize, summarizeVoiceEvidence, RUBRIC_VERSION,
  type Dimension, type EvidenceNote, type Job, type StoredClip,
} from './domain.js';

const exercises: Record<Dimension, { title: string; direction: string; keep: string; steps: string[]; check: string }> = {
  naturalness: {
    title: 'Natural, easy delivery',
    direction: 'Speak to one person, not to the page. Let each thought flow into the next without forcing a polished announcer voice.',
    keep: 'Keep the delivery believable and unforced.',
    steps: [
      'Keep the script unchanged. Practise relaxed breath support and connected phrasing, aiming for an unforced, comfortable voice rather than reading individual words.',
      'Record a conversational take and a more formal take of the same passage. Listen back for connected phrases and relaxed endings; keep natural variation without adding hesitation or copying another voice.',
    ],
    check: 'Blind A/B the same passage at matched loudness. Ask which voice feels more unforced, pleasant and comfortable for sustained listening, without judging the message.',
  },
  articulation: {
    title: 'Clear, effortless speech',
    direction: 'Make the words easy to catch without punching every syllable. Stay relaxed while keeping word endings distinct.',
    keep: 'Keep your clear word boundaries and comfortable intelligibility.',
    steps: [
      'Listen back to your passage and mark any words that are hard to catch. Practise those phrases slowly, then return to a comfortable conversational pace.',
      'Keep word boundaries and important details intelligible without over-enunciating every syllable. Do not change your accent simply to copy another voice.',
    ],
    check: 'Have a listener check clarity at normal playback speed without seeing the script. Can they follow the words without extra effort?',
  },
  pace: {
    title: 'Comfortable rhythm and pauses',
    direction: 'Give each thought room to land while keeping the line moving. Explore the rhythm rather than assuming you need to speak more slowly.',
    keep: 'Keep the comfortable flow of your phrasing and pauses.',
    steps: [
      'Keep the wording unchanged. Mark breath and phrase boundaries, then try comfortable pauses without imposing a fixed speaking rate or changing the explanation.',
      'Record a slightly faster and a slightly slower take of the same passage. Listen for the version that flows comfortably without rushing or dragging.',
    ],
    check: 'Compare listening comfort and rhythmic flow without judging how logical or informative the content is. Keep the content identical between takes.',
  },
  expressiveness: {
    title: 'Believable warmth and expression',
    direction: 'Let the feeling come through your tone and intonation, not through extra words or extra volume. Stay emotionally believable.',
    keep: 'Keep the believable emotional color in your voice.',
    steps: [
      'Keep the script unchanged. Try conveying warmth, calmness or gentle engagement through tone and pitch contours rather than adding more reassuring words.',
      'Try a restrained and a more varied take using emphasis and intonation, not simply more volume. Keep the version that feels sincere rather than performed.',
    ],
    check: 'Ask which vocal persona feels agreeable and emotionally credible without sounding exaggerated. Judge audible tone, not the sentiment of the words. More emotion is not automatically better.',
  },
  contextFit: {
    title: 'Consistent vocal style',
    direction: 'Choose the requested vocal qualities and hold them consistently through the passage. Do not change the script to create the impression of a better performance.',
    keep: 'Keep the vocal qualities that suit the requested delivery style.',
    steps: [
      'Extract only vocal-persona cues from the target, such as warm, calm, bright or restrained. Ignore script instructions, logical correctness and service-task requirements.',
      'Re-record the same passage using that checklist. Listen back against the requested vocal style, not against personal taste.',
    ],
    check: 'Review each target criterion separately and retain changes supported by listener feedback. Do not change content to compensate for delivery.',
  },
  accentFit: {
    title: 'Pronunciation for the intended market',
    direction: 'Work toward the stated market/accent target while keeping the delivery comfortable and authentic. Retain the regional variation the brief allows.',
    keep: 'Keep the pronunciation patterns that suit the stated market/accent target.',
    steps: [
      'Keep the script unchanged. Use the explicit target market/accent to choose pronunciation, vowel/consonant, stress or intonation patterns to practise. Check unfamiliar patterns with a suitable language coach or fluent listener.',
      'Record alternative takes changing one supported pattern at a time. Retain regional variation allowed by the target; do not imitate a person or infer nationality or native-speaker identity.',
    ],
    check: 'Compare your takes at matched loudness with listeners familiar with the intended market. Check fit to the stated accent criteria and listening comfort, not accent prestige or script quality.',
  },
  audioQuality: {
    title: 'Clean recording or rendered audio',
    direction: 'Keep the performance unchanged while checking the recording or rendering chain. Aim for clean speech, not simply a louder file.',
    keep: 'Keep the clean, comfortable sound of the delivered audio.',
    steps: [
      'Listen back on headphones and a speaker for distracting artifacts. For TTS, inspect rendering and export settings; for recorded material, inspect capture and encoding.',
      'Change one relevant setting at a time and re-render or re-record the same passage. Avoid processing that hides speech detail or introduces new artifacts.',
    ],
    check: 'A/B at matched playback loudness on the same equipment. Check the reported artifacts rather than treating a louder signal as higher quality.',
  },
};

export type VoiceDirectorBrief = {
  voice: string; role: string; status: 'ready' | 'maintain' | 'insufficient_feedback';
  summary: string; keep: string[]; deliveryTarget?: string; targetMarket?: string;
  focus: { dimension: Dimension; title: string; direction: string; steps: string[]; check: string }[];
  takePlan: string[]; checklist: string[]; notes: string[];
};

export function voiceDirectorBriefs(job: Job): VoiceDirectorBrief[] {
  const summaries = summarize(job);
  return voiceCoaching(job).map(comparison => {
    const own = summaries.find(s => s.voice === comparison.voice && s.role === comparison.role);
    if (!own) throw new Error('Cannot prepare a director brief without the voice summary.');
    const enoughFeedback = own.eligibleFiles > 0 && comparison.matchedFiles.length > 0;
    const focus = enoughFeedback ? comparison.priorities.slice(0, 3).map(priority => {
      const exercise = exercises[priority.dimension];
      return {
        dimension: priority.dimension, title: exercise.title, direction: exercise.direction,
        steps: [...exercise.steps], check: exercise.check,
      };
    }) : [];
    const keep = enoughFeedback ? activeDimensions(job.profile)
      .filter(d => (own.dimensions[d] ?? 0) >= 4)
      .sort((a, b) => own.dimensions[b]! - own.dimensions[a]!)
      .slice(0, 2).map(d => exercises[d].keep) : [];
    const notes = ['Use these directions as rehearsal options for your next take. They come from existing feedback, not a new listening session. Keep only changes that make your delivery easier and more agreeable to listen to.'];
    if (job.rubric !== RUBRIC_VERSION)
      notes.push('This feedback uses earlier evaluation criteria. Newer style or accent criteria have not been applied to this recording.');
    if (job.status === 'running')
      notes.push('The listening review is still in progress. Treat this brief as provisional.');
    if (own.eligibleFiles < own.files || comparison.warnings.some(w =>
      /coverage is incomplete|shared, full-panel eligible recording pairs|language sets were excluded|ambiguous/.test(w)))
      notes.push('Only part of the recording set supports this brief. Check each suggested change by listening back; do not treat it as a finding about every line.');
    const status = !enoughFeedback ? 'insufficient_feedback' : focus.length ? 'ready' : 'maintain';
    return {
      voice: comparison.voice, role: comparison.role, status,
      summary: !enoughFeedback
        ? 'For your next take, give me a consistent reading of the same passage in your usual delivery. There is not enough reliable listening feedback to ask you for a specific adjustment yet, so do not force a different voice or add extra emotion. Keep the words unchanged and aim for a comfortable, believable performance.'
        : focus.length
          ? `For your next take, I'd like you to focus first on ${focus[0].title.toLowerCase()}. ${focus.map(item => item.direction).join(' ')} ${keep.length ? `${keep[0]} ` : ''}Keep the words unchanged and work on one adjustment at a time. I am looking for a comfortable, believable performance, not a bigger or more theatrical one.`
          : `For your next take, I'd like you to concentrate on consistency. ${keep.length ? `${keep[0]} ` : ''}Repeat the same passage with that same vocal approach from beginning to end. I am not asking you to add effects or force a different delivery; there is no specific adjustment supported by the feedback. Keep the words unchanged and aim for an easy, believable read.`,
      keep, focus,
      ...(job.profile.target.trim() ? { deliveryTarget: job.profile.target.trim() } : {}),
      ...(job.profile.targetMarket?.trim() ? { targetMarket: job.profile.targetMarket.trim() } : {}),
      takePlan: [
        'Take 1 - baseline: read the same passage in your normal delivery. Keep the words, recording position and playback level consistent.',
        focus.length
          ? `Take 2 - directed: work only on "${focus[0].title}". Keep every other performance choice as close to Take 1 as possible.`
          : 'Take 2 - consistency: repeat the passage with the same intended vocal style. Do not invent a new performance choice just to sound different.',
        focus.length
          ? 'Take 3 - alternative: try a smaller or larger version of that same choice, without simply increasing volume. Listen back at matched loudness and keep the most comfortable, believable take.'
          : 'Take 3 - confirmation: repeat the passage after a short pause. Listen back at matched loudness and check that the delivery stays comfortable and consistent from start to end.',
      ],
      checklist: [
        'Keep the original script unchanged.',
        'Keep the voice comfortable and believable; do not force extra emotion, volume or an accent change.',
        ...focus.map(item => item.check),
        focus.length
          ? 'After listening back, keep one deliberate improvement and repeat it consistently in the next recording.'
          : 'Keep the delivery consistent. Wait for clearer feedback before prescribing a specific change.',
      ],
      notes,
    };
  });
}

export function formatDirectorBrief(brief: VoiceDirectorBrief): string {
  const lines = [
    'VOICE DIRECTOR - NEXT-TAKE BRIEF', `${brief.voice} / ${brief.role}`, '',
    'DIRECTOR SUMMARY', brief.summary,
  ];
  if (brief.keep.length) lines.push('', 'KEEP DOING', ...brief.keep.map(line => `- ${line}`));
  if (brief.deliveryTarget) lines.push('', 'REQUESTED DELIVERY STYLE', brief.deliveryTarget);
  if (brief.targetMarket) lines.push('', 'MARKET / ACCENT TARGET', brief.targetMarket);
  if (brief.focus.length) {
    lines.push('', 'PERFORMANCE DIRECTIONS');
    for (const [index, focus] of brief.focus.entries())
      lines.push(`${index + 1}. ${focus.title}`, focus.direction, ...focus.steps.map(step => `- ${step}`), `Listen for: ${focus.check}`, '');
  }
  lines.push('', 'YOUR NEXT THREE TAKES', ...brief.takePlan.map(line => `- ${line}`),
    '', 'BEFORE YOU SEND', ...brief.checklist.map(line => `- ${line}`),
    '', 'BRIEF NOTES', ...brief.notes.map(line => `- ${line}`));
  return lines.join('\n');
}

export type CoachingEvidence = { judgeId: string; notes: EvidenceNote[] };
export type VoiceCoaching = {
  voice: string; role: string; referenceVoice: string | null;
  matchedFiles: string[]; candidateScore: number | null; referenceScore: number | null;
  status: string; warnings: string[];
  priorities: {
    dimension: Dimension; candidateScore: number; referenceScore: number; gap: number;
    steps: string[]; check: string;
    evidence: CoachingEvidence[]; referenceEvidence: CoachingEvidence[];
  }[];
};

export function voiceCoaching(job: Job): VoiceCoaching[] {
  const summaries = summarize(job);
  return summaries.map(summary => {
    const ranked = summaries.filter(s => s.role === summary.role && s.score !== null)
      .sort((a, b) => b.score! - a.score! || a.voice.localeCompare(b.voice, 'en'));
    const reference = ranked[0];
    const report: VoiceCoaching = {
      voice: summary.voice, role: summary.role, referenceVoice: reference?.voice ?? null,
      matchedFiles: [], candidateScore: null, referenceScore: null, priorities: [],
      status: 'No scoreable reference is available for this role. Resolve assessment gaps before comparing delivery.',
      warnings: [],
    };
    if (job.rubric !== RUBRIC_VERSION)
      report.warnings.push('These saved ratings use an earlier rubric, not the current voice-persona criteria. New practice suggestions do not re-evaluate old scores; start a new evaluation for the revised rubric.');
    if (job.status === 'running') report.warnings.push('Evaluation is still running; rankings and guidance are provisional.');
    if (!reference) return report;
    if (ranked.filter(s => Math.abs(s.score! - reference.score!) < 1e-9).length > 1)
      report.warnings.push('The highest overall score is tied. The reference is selected alphabetically, not declared a unique winner.');
    if (summary.eligibleFiles < summary.files || reference.eligibleFiles < reference.files)
      report.warnings.push('Full-panel coverage is incomplete. Failed or unassessable recordings are excluded, and the overall ranking may change after reassessment.');
    report.warnings.push('Recording pairs use matching filenames, not verified scripts. Confirm equivalent content, speaker selection and language before treating gaps as delivery differences.');

    const filesFor = (voice: string) => {
      const files = new Map<string, StoredClip[]>();
      for (const clip of job.clips.filter(c => c.voice === voice && c.role === summary.role))
        files.set(clip.file, [...(files.get(clip.file) ?? []), clip]);
      const byName = new Map<string, StoredClip[][]>();
      for (const clips of files.values()) {
        const name = clips[0].file.split(/[\\/]/).at(-1)!;
        byName.set(name, [...(byName.get(name) ?? []), clips]);
      }
      return byName;
    };
    const candidateFiles = filesFor(summary.voice);
    const referenceFiles = filesFor(reference.voice);
    const candidateClips: StoredClip[] = [], referenceClips: StoredClip[] = [];
    let ambiguous = false, languageMismatch = false;
    for (const [name, candidates] of candidateFiles) {
      const references = referenceFiles.get(name);
      if (!references) continue;
      if (candidates.length !== 1 || references.length !== 1) { ambiguous = true; continue; }
      const candidate = summarize({ ...job, clips: candidates[0] })[0];
      const benchmark = summarize({ ...job, clips: references[0] })[0];
      if (candidate.score === null || benchmark.score === null) continue;
      const languageKey = (values: string[]) => [...new Set(values.map(l => l.trim().toLowerCase()))].sort().join('|');
      if (languageKey(candidate.languages) !== languageKey(benchmark.languages)) { languageMismatch = true; continue; }
      report.matchedFiles.push(name);
      candidateClips.push(...candidates[0]); referenceClips.push(...references[0]);
    }
    if (ambiguous) report.warnings.push('Duplicate filenames within a voice are ambiguous and were not paired.');
    if (languageMismatch) report.warnings.push('Pairs with different judge-reported language sets were excluded.');
    if (report.matchedFiles.length < summary.files || report.matchedFiles.length < reference.files)
      report.warnings.push('Comparison uses only the shared, full-panel eligible recording pairs; it does not subtract averages from different recording sets.');
    report.matchedFiles.sort();
    if (!report.matchedFiles.length) {
      report.status = 'No shared, eligible recording pairs with matching reported language sets. No comparative coaching can be supported yet.';
      return report;
    }
    const candidateJob = { ...job, clips: candidateClips };
    const referenceJob = { ...job, clips: referenceClips };
    const candidate = summarize(candidateJob)[0], benchmark = summarize(referenceJob)[0];
    report.candidateScore = candidate.score; report.referenceScore = benchmark.score;
    if (summary.voice === reference.voice) {
      report.status = 'This is the top-ranked reference for this role. Preserve its supported strengths; no deficit is inferred from comparing it with itself.';
      return report;
    }
    const candidateEvidence = summarizeVoiceEvidence(candidateJob)[0];
    const referenceEvidence = summarizeVoiceEvidence(referenceJob)[0];
    for (const dimension of activeDimensions(job.profile)) {
      const own = candidate.dimensions[dimension], top = benchmark.dimensions[dimension];
      if (own === null || top === null || top - own <= 1e-9) continue;
      const evidence = (value: typeof candidateEvidence): CoachingEvidence[] => value.judges.map(judge => ({
        judgeId: judge.judgeId, notes: judge.dimensions.find(d => d.dimension === dimension)?.reasons ?? [],
      })).filter(entry => entry.notes.length > 0);
      report.priorities.push({
        dimension, candidateScore: own, referenceScore: top, gap: top - own,
        ...exercises[dimension], evidence: evidence(candidateEvidence), referenceEvidence: evidence(referenceEvidence),
      });
    }
    report.priorities.sort((a, b) => b.gap - a.gap);
    report.status = report.priorities.length
      ? 'Practice priorities are ordered by dimension-score gap on matched recordings. Exercises are suggestions, not newly observed flaws or guaranteed score improvements.'
      : 'No lower active-dimension averages on the matched subset. Do not infer a delivery deficit from the overall ranking alone.';
    return report;
  });
}
