import { clipSchema, clipScopeError, settingsSchema, profileSchema, languageHintSchema, testNameSchema, rolesForScope, MAX_SECONDS, type DraftClip, type Profile, type Settings } from '../shared/domain';
import type { Recording } from './audio';
import { testNameMetadata } from '../shared/history';

export const DEFAULT_TEST_GUIDE = 'This test evaluates the quality of a service agent’s voice in a call center context. You will hear recorded conversations between a customer and an agent. **Evaluate only the agent’s voice** and compare it with how a natural, authentic call center agent typically sounds in real-world interactions. **Do not evaluate or score the customer’s voice or speaking behavior.** All ratings and comments must focus exclusively on the agent, and your comments should be **as detailed and specific as possible**, describing the agent’s voice quality, naturalness, speaking style, delivery, and any noticeable strengths or issues that influenced your score.';

export function withTestNameLanguage(profile: Profile, name: string): Profile {
  const { languages } = testNameMetadata(name);
  return withLanguageAccent(profile, languages.length === 1 ? languages[0] : 'auto');
}

type Reviewable = Pick<Recording, 'regions' | 'duration'>;
export function withLanguageAccent(profile: Profile, value = profile.targetMarket?.trim() || profile.language): Profile {
  return { ...profile, language: value, targetMarket: value.trim().toLowerCase() === 'auto' ? '' : value };
}
export function applyLanguageHint<T extends { language: string }>(inputs: T[], language: string): T[] {
  const hint = languageHintSchema.parse(language);
  return inputs.map(input => ({ ...input, language: hint }));
}
export function inputCount(recordings: Reviewable[], scope: Profile['scope'], speakerMode: Profile['speakerMode']): number {
  return recordings.reduce((total, recording) => total + (speakerMode === 'automatic'
    ? Math.max(1, Math.ceil((recording.duration ?? MAX_SECONDS) / MAX_SECONDS)) * rolesForScope(scope).length
    : recording.regions.length), 0);
}
export function recordingReviewed(recording: Reviewable, scope: Profile['scope']): boolean {
  const roles = rolesForScope(scope);
  return recording.regions.length > 0 &&
    recording.regions.every(region => region.confirmed && roles.includes(region.role)) &&
    roles.every(role => recording.regions.some(region => region.role === role));
}

export function evaluationBlockers(input: {
  name: string; profile: Profile; config?: Settings & { configured: boolean };
  recordings: (Reviewable & Pick<Recording, 'include'>)[];
  savedClips?: DraftClip[];
  scope: Profile['scope']; speakerMode?: Profile['speakerMode']; consent: boolean; busy: boolean; running: boolean;
}): string[] {
  const blockers: string[] = [];
  const name = testNameSchema.safeParse(input.name);
  if (!name.success) blockers.push(name.error.issues[0].message);
  const profile = profileSchema.safeParse(input.profile);
  if (!profile.success) blockers.push(...profile.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`));
  if (!input.config) blockers.push('Wait for the Azure settings to load. Check the connection if they do not appear.');
  else {
    if (!input.config.configured) blockers.push('Save your Azure endpoint and API key in Azure connection.');
    if (!settingsSchema.safeParse(input.config).success)
      blockers.push('Configure at least one judge and complete every judge name and Azure deployment name.');
  }
  const recordings = input.recordings.filter(recording => recording.include);
  if (input.savedClips) {
    const clips = input.savedClips.filter(c => c.include);
    if (!clips.length) blockers.push('Include at least one saved audio input or select an audio folder.');
    if (clips.some(c => !clipSchema.safeParse(c).success)) blockers.push('Complete every saved input voice and language hint.');
    const error = clipScopeError(input.scope, clips);
    if (error) blockers.push(error);
    if (clips.length > 200) blockers.push('Reduce the selection to at most 200 role/audio inputs per evaluation.');
  } else if (!recordings.length) blockers.push('Select an audio folder and include at least one recording.');
  else if (input.speakerMode !== 'automatic') {
    const remaining = recordings.filter(recording => !recordingReviewed(recording, input.scope)).length;
    if (remaining) blockers.push(`Confirm speaker regions for ${remaining} remaining recording${remaining === 1 ? '' : 's'} (${recordings.length - remaining}/${recordings.length} reviewed). Open each recording and click Confirm speaker regions.`);
  }
  if (!input.savedClips && inputCount(recordings, input.scope, input.speakerMode) > 200)
    blockers.push('Reduce the selection to at most 200 role/audio inputs per evaluation.');
  if (!input.consent) blockers.push('Tick the permission checkbox to authorize sending selected audio to Azure.');
  if (input.busy) blockers.push('Wait for the current operation to finish.');
  if (input.running) blockers.push('Wait for the running evaluation to finish, or cancel it from Results.');
  return blockers;
}
