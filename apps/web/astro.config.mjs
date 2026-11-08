import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://prokashnews.online',
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
});
