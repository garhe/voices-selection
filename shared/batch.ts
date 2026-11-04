import { z } from 'zod';
import type { VoiceGender } from './domain.js';

const directoryPathSchema = z.string().trim().transform(value => value.replace(/^"(.*)"$/, '$1')).pipe(z.string().min(1));
export const batchDirectorySchema = z.union([
  z.object({ directory: directoryPathSchema }).strict(),
  z.object({ directories: z.array(directoryPathSchema).min(1) }).strict(),
]);
export type BatchRequest = z.infer<typeof batchDirectorySchema>;
export const supportedAudio = /\.(wav|mp3|m4a|ogg|flac|aac|webm|opus)$/i;
export type BatchFile = { id: string; path: string; voice: string; size: number };
export type BatchTest = {
  name: string; languages: string[]; genders: VoiceGender[]; files: BatchFile[]; errors: string[];
};
export type BatchPreview = BatchRequest & { token: string; tests: BatchTest[]; ignoredFiles: number };
