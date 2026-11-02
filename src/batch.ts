import { profileSchema, settingsSchema, type Judge, type Profile } from '../shared/domain';
import type { BatchTest } from '../shared/batch';
import { withTestNameLanguage } from './readiness';

export type BatchSubmission = { name: string; id?: string; error?: string };
export function batchTestProfile(profile: Profile, name: string): Profile {
  return profileSchema.parse(withTestNameLanguage({ ...profile, speakerMode: 'automatic' }, name));
}
export async function submitBatch(
  tests: BatchTest[], profile: Profile, judges: Judge[],
  queue: (test: BatchTest, profile: Profile, judges: Judge[]) => Promise<{ id: string }>,
  report: (result: BatchSubmission) => void,
): Promise<void> {
  const panel = settingsSchema.parse({ judges }).judges;
  for (const test of tests) {
    try {
      if (test.errors.length) throw new Error(test.errors.join(' '));
      const job = await queue(test, batchTestProfile(profile, test.name), structuredClone(panel));
      report({ name: test.name, id: job.id });
    } catch (error) {
      report({ name: test.name, error: error instanceof Error ? error.message : 'Unexpected batch submission failure.' });
    }
  }
}
