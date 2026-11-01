import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const GITHUB_REPO = 'https://github.com/actdim/msgmesh-store';

export default withMermaid(
  defineConfig({
    base: '/msgmesh-store/',
    outDir: '../.dist-docs',
    cacheDir: '../node_modules/.cache/vitepress',
    title: 'MsgMesh Store',
    description: 'Message bus bridge and Change Data Capture (CDC) engine connecting @actdim/msgmesh with persistent stores (LiveStruct & LiveStore)',
    cleanUrls: true,
    lastUpdated: true,
    sitemap: {
      hostname: 'https://actdim.github.io/msgmesh-store/'
    },
    ignoreDeadLinks: true,

    rewrites: {
      'INDEX.md': 'index.md'
    },

    markdown: {
      config: (md) => {
        const defaultRender =
          md.renderer.rules.link_open ||
          function (tokens, idx, options, env, self) {
            return self.renderToken(tokens, idx, options);
          };

        md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
          const token = tokens[idx];
          const hrefIndex = token.attrIndex('href');
          if (hrefIndex >= 0) {
            const href = token.attrs![hrefIndex][1];
            if (href.startsWith('../')) {
              token.attrs![hrefIndex][1] = `${GITHUB_REPO}/blob/main/${href.slice(3)}`;
            }
          }
          return defaultRender(tokens, idx, options, env, self);
        };
      }
    },

    themeConfig: {
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Overview', link: '/topic--01-overview-and-advantages' },
        { text: 'Core Concepts', link: '/topic--02-core-concepts' },
        { text: 'Integration', link: '/topic--04-integration-guide' },
        { text: 'API Reference', link: '/topic--05-api-reference' },
        { text: 'LiveStruct', link: 'https://actdim.github.io/livestruct/' },
        { text: 'GitHub', link: GITHUB_REPO }
      ],

      sidebar: [
        {
          text: 'Overview & Index',
          items: [
            { text: 'Knowledge Base Index', link: '/' },
            { text: 'Overview & Advantages', link: '/topic--01-overview-and-advantages' }
          ]
        },
        {
          text: 'Architecture & Wiring',
          items: [
            { text: 'Core Concepts', link: '/topic--02-core-concepts' },
            { text: 'Architecture & Wiring', link: '/topic--03-architecture-and-wiring' },
            { text: 'System Architecture', link: '/topic--architecture' },
            { text: 'Domain Model', link: '/topic--domain-model' }
          ]
        },
        {
          text: 'Integration & API Reference',
          items: [
            { text: 'Integration Guide', link: '/topic--04-integration-guide' },
            { text: 'API Reference', link: '/topic--05-api-reference' }
          ]
        },
        {
          text: 'Development & Operations',
          items: [
            { text: 'Setup & Workflow', link: '/topic--setup-and-workflow' },
            { text: 'License', link: '/topic--license' }
          ]
        }
      ],

      search: {
        provider: 'local'
      },

      socialLinks: [
        { icon: 'github', link: GITHUB_REPO }
      ],

      editLink: {
        pattern: `${GITHUB_REPO}/edit/main/docs/:path`,
        text: 'Edit this page on GitHub'
      },

      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright (c) 2025-2026 actdim'
      }
    },

    mermaid: {
      theme: 'default'
    }
  })
);
