import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    /*
     * `s1f8940o` rather than `svelte-1f8940o`, which is six bytes back on every scoped element.
     *
     * Small per element and not small in aggregate: a region page in the terminal carries
     * 5,764 of them, and the directory ships 11,500 prerendered pages. Kept hash-derived
     * rather than a counter so the name depends only on the component's own CSS — a build
     * that changes nothing produces byte-identical output, which is what lets Vercel store one
     * copy across deployments instead of one per deployment.
     */
    cssHash: ({ hash, css }) => `s${hash(css)}`
  },
  kit: {
    // Static output only. No server, so no server that knows anything about anyone.
    adapter: adapter({ fallback: undefined, strict: true }),
    prerender: { entries: ['*'] }
  }
};

export default config;
