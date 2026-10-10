import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(10).max(120),
      description: z.string().min(50).max(170),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      draft: z.boolean().default(false),
      category: z.string().default('general'),
      sources: z.array(z.string().url()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      coverCredit: z
        .object({
          name: z.string(),
          page: z.string().url(),
          profile: z.string().url().optional(),
          source: z.string().optional(),
        })
        .optional(),
    }),
});

export const collections = { posts };
