// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

// GitHub Pages:
//  - Custom domain (e.g. www.basedinc.com): leave BASE_PATH unset.
//  - Project page (user.github.io/repo): set BASE_PATH=/repo in the workflow.
// The deploy workflow fills these from the repo's Pages settings automatically.
const site = process.env.SITE_URL || 'https://www.basedinc.com';
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: { responsiveStyles: true },
  integrations: [sitemap()],
});