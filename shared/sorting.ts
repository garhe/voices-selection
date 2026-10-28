import { z } from 'zod';

export function parseSortingPaths(text: string): string[] {
  return text.split(/\r\n?|\n/).map(line => line.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

export const sortingRequestSchema = z.object({
  paths: z.array(z.string().trim().min(1).max(2000)).min(1),
  mode: z.enum(['keep', 'replace']).default('keep'),
  outputDirectory: z.string().trim().max(2000).default(''),
  nameFormat: z.string().trim().min(1).max(255).default('{name}_sorted'),
}).strict();
export type SortingRequest = z.infer<typeof sortingRequestSchema>;
export const sortingApplySchema = z.object({ token: z.string().uuid(), confirmed: z.literal(true) }).strict();
export const sortingPlanSchema = z.object({
  wavFiles: z.number().int().positive(),
  voiceFolders: z.number().int().positive(),
  renamedFiles: z.number().int().nonnegative(),
  omittedFiles: z.number().int().nonnegative(),
  mappings: z.array(z.object({ source: z.string(), destination: z.string() })),
});
export type SortingPlan = z.infer<typeof sortingPlanSchema>;
export type SortingPreview = {
  token: string; expiresAt: string; mode: SortingRequest['mode'];
  entries: { source: string; output?: string; plan?: SortingPlan; error?: string }[];
};
export type SortingResults = { mode: SortingRequest['mode']; entries: { source: string; output?: string; error?: string }[] };
