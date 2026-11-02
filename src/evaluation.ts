import { automaticRegions, base64, decode, toPcm, type Recording } from './audio';
import { resolveLanguageHint, type Profile, type Clip } from '../shared/domain';

export async function prepareEvaluationClips(
  recordings: Recording[], profile: Profile,
  upload: (clip: Clip, pcm: string) => Promise<void>,
  progress: (message: string) => void,
  initialIds: string[] = [],
  audio = { decode, toPcm },
): Promise<string[]> {
  const ids = [...initialIds];
  for (const [index, recording] of recordings.entries()) {
    progress(`Preparing ${index + 1}/${recordings.length}: ${recording.file.name}`);
    const buffer = await audio.decode(recording.file);
    const regions = profile.speakerMode === 'automatic' ? automaticRegions(buffer.duration, profile.scope) : recording.regions;
    if (ids.length + regions.length > 200)
      throw new Error('The complete recordings require more than 200 role/audio inputs. Include fewer files in this evaluation; no audio is silently truncated.');
    for (const region of regions) {
      const id = crypto.randomUUID();
      await upload({
        id, voice: recording.voice, file: recording.path, role: region.role, start: region.start, end: region.end,
        channel: region.channel, language: resolveLanguageHint(recording.language, profile.language),
      }, base64(await audio.toPcm(buffer, region)));
      ids.push(id);
    }
  }
  return ids;
}
