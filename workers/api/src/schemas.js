import { z } from 'zod';

export const loginSchema = z.object({
  passcode: z.string().min(1, "Passcode is required").max(128)
});

export const createEntrySchema = z.object({
  data: z.object({
    slug: z.string().regex(/^[a-zA-Z0-9-]{3,64}$/).optional().or(z.literal('')),
    content: z.string().max(512_000).optional().default(''),
    is_guest: z.boolean().optional().default(false),
  }),
  passcode: z.string().max(128).optional(),
});

export const fileMetaSchema = z.object({
  filename: z.string().min(1),
  key: z.string().min(1).regex(/^[a-zA-Z0-9_\-.]{1,512}$/, 'Invalid key format'),
  size: z.number().positive(),
  owner: z.string().nullish(),
  is_guest: z.boolean().optional().default(false),
  entry_id: z.number().int().positive()
});
