import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = 'https://dev.ilmora.tech';

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'BCStudio',
      description:
        'Open-source Business Central API SDK by Ilmora, for TypeScript, Python and PHP. Handles OAuth2, OData filters, ETag, pagination and bound actions.',
      logo: {
        src: './src/assets/logo-mark.svg',
        alt: 'Ilmora',
      },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/hassannazeer/ibs-bcstudio',
        },
      ],
      head: [
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: `${site}/og.png` },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:alt', content: 'BCStudio by Ilmora, open-source Business Central API SDK for TypeScript, Python and PHP.' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: `${site}/og.png` },
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: '' },
            { label: 'Install', slug: 'install' },
            { label: 'Quickstart', slug: 'quickstart' },
          ],
        },
        {
          label: 'Using the SDK',
          items: [
            { label: 'The traps it handles', slug: 'traps' },
            { label: 'Packages', slug: 'packages' },
          ],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Project',
          items: [
            { label: 'License', slug: 'license' },
            {
              label: 'GitHub repository',
              link: 'https://github.com/hassannazeer/ibs-bcstudio',
              attrs: { target: '_blank', rel: 'noopener' },
            },
          ],
        },
      ],
      credits: false,
    }),
  ],
});
