// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'BALDR Accessibility Scan',
  tagline: 'Audit accessibilite RGAA/WCAG enrichi par Intelligence Artificielle',
  favicon: 'img/logo.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://malakoffhumanis.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/baldr-accessibility-scan/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'malakoffhumanis',
  projectName: 'baldr-accessibility-scan',

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'fr',
    locales: ['fr'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/malakoffhumanis/baldr-accessibility-scan/tree/main/website/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl:
            'https://github.com/malakoffhumanis/baldr-accessibility-scan/tree/main/website/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/dashboard.png',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'BALDR',
        logo: {
          alt: '',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {to: '/blog', label: 'Actualites', position: 'left'},
          {
            href: 'https://github.com/malakoffhumanis/baldr-accessibility-scan',
            label: 'GitHub (nouvelle fenetre)',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Demarrage',
                to: '/docs/',
              },
              {
                label: 'Journey API',
                to: '/docs/journey-api',
              },
            ],
          },
          {
            title: 'Ressources',
            items: [
              {
                label: 'Metriques',
                to: '/docs/metrics',
              },
              {
                label: 'Actualites',
                to: '/blog',
              },
              {
                label: 'Plan du site',
                href: 'https://malakoffhumanis.github.io/baldr-accessibility-scan/sitemap.xml',
              },
            ],
          },
          {
            title: 'Projet',
            items: [
              {
                label: 'README GitHub (nouvelle fenetre)',
                href: 'https://github.com/malakoffhumanis/baldr-accessibility-scan#readme',
              },
              {
                label: 'GitHub (nouvelle fenetre)',
                href: 'https://github.com/malakoffhumanis/baldr-accessibility-scan',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} BALDR Accessibility Scan. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
