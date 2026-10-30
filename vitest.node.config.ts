import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import config from './packageConfig';

export default defineConfig({
    test: {
        watch: false,
        reporters: 'verbose',
        name: 'node',
        globals: true,
        setupFiles: [resolve('./vitest.setup.ts')],
        isolate: false,
        pool: 'forks',
        environment: 'node',
        include: ['tests/**/*.{test,spec}.ts'],
        includeSource: ['src/**/*.ts'],
        typecheck: {
            tsconfig: 'tsconfig.dev.json',
        },
        root: resolve('.'),
    },
    resolve: {
        alias: config.resolveAliases(),
    },
    base: './',
});
