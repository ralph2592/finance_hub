import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://finance-hub.ralph-rds.workers.dev',
  integrations: [sitemap()],
});
