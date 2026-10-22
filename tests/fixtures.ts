import { randomUUID } from 'node:crypto';
import type { Assessment, Job, Profile, StoredClip } from '../shared/domain.js';
export const profile: Profile = { stage: 'audition', scope: 'single', language: 'auto', target: '' };
export function assessment(value = 4): Assessment {
  return {
    language: 'English', languageSupported: true, assessable: true,
    scores: { naturalness: value, articulation: value, pace: value, expressiveness: value, contextFit: null, accentFit: null, audioQuality: 1 },
    reasons: {
      naturalness: 'Fluid delivery.', articulation: 'Clear articulation.', pace: 'Even rhythm.',
      expressiveness: 'Controlled prosody.', contextFit: 'No target provided.', accentFit: 'No target market provided.', audioQuality: 'Audible room noise.',
    }, observations: ['A listening opinion.'], limitations: ['Not calibrated to human ratings.'],
  };
}
// Captured from the Windows TTS diagnostic; inactive accent-fit fields adapt it to the current schema.
export const syntheticAzureAssessment: Assessment = {
  language: 'English', languageSupported: true, assessable: true,
  speakerAttribution: {
    role: 'speaker', status: 'identified',
    evidence: 'The speaker provides assistance and explains that they will check details and explain next steps, which matches the role of the speaker offering service or support.',
  },
  scores: { naturalness: 4, articulation: 4.5, pace: 4, expressiveness: 3.5, contextFit: null, accentFit: null, audioQuality: 4 },
  reasons: {
    naturalness: 'Delivery is smooth and believable, with only slight indications of formality or scripted speech.',
    articulation: 'Words are clearly articulated and easy to understand, with minimal slurring or mumbling.',
    pace: 'The pace is measured and appropriate, with natural pauses and no noticeable rushing or dragging.',
    expressiveness: 'Moderate variation in tone and emphasis, though somewhat restrained and lacking strong emotional cues.',
    contextFit: 'No target style was provided, so contextFit cannot be assessed.',
    accentFit: 'No target market/accent was provided.',
    audioQuality: 'Good audio quality with clear sound and minimal background noise, though slight compression artifacts are present.',
  },
  observations: [
    'The speaker maintains a professional and helpful tone throughout.',
    'The speech is clearly articulated and well-paced, making it easy to follow the message.',
  ],
  limitations: [
    'No specific target style was provided, so contextFit could not be evaluated.',
    'Expressiveness is somewhat limited, as the speaker maintains a neutral and controlled tone without strong emotional variation.',
  ],
};
export function clip(patch: Partial<StoredClip> = {}): StoredClip {
  return {
    id: randomUUID(), voice: 'Candidate A', file: 'collection/Candidate A/one.wav',
    role: 'speaker', start: 0, end: 1, channel: 'mix', language: 'auto',
    technical: { peakDb: -10, rmsDb: -20, clippingPercent: 0, quietPercent: 0, seconds: 1 }, ...patch,
  };
}
export function job(clips = [clip()], values = [4, 2]): Job {
  const judges = values.map((_, i) => ({ id: randomUUID(), name: `Judge ${i + 1}`, deployment: `deployment-${i}` }));
  return {
    id: randomUUID(), createdAt: new Date().toISOString(), status: 'completed', rubric: 'audio-only-v1',
    profile, judges, clips, results: clips.flatMap(c => judges.map((j, i) => ({
      clipId: c.id, judgeId: j.id, status: 'completed', assessment: assessment(values[i]),
    }))),
  };
}
