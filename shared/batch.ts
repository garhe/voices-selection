import { z } from 'zod';
import type { VoiceGender } from './domain.js';

export const batchDirectorySchema = z.object({
  directory: z.string().trim().min(1).transform(value => value.replace(/^"(.*)"$/, '$1')),
}).strict();
export const supportedAudio = /\.(wav|mp3|m4a|ogg|flac|aac|webm|opus)$/i;
export type BatchFile = { id: string; path: string; voice: string; size: number };
export type BatchTest = {
  name: string; languages: string[]; genders: VoiceGender[]; files: BatchFile[]; errors: string[];
};
export type BatchPreview = { token: string; directory: string; tests: BatchTest[]; ignoredFiles: number };
