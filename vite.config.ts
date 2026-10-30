import { defineConfig } from 'vite';
import * as path from 'path';
import config from './packageConfig';
import dts from 'vite-plugin-dts';
import tsConfigPaths from 'vite-tsconfig-paths';
import * as packageJson from './package.json';

const packageName = packageJson.name.split('/').reverse()[0];

export default defineConfig({
    resolve: {
        alias: config.resolveAliases(),
    },
    build: {
        outDir: 'dist',
        lib: {
            entry: './src/index.ts',
            formats: ['es'],
            fileName: (format) => `${packageName}.${format}.js`,
        },
        rollupOptions: {
            input: config.srcFiles(),
            external: config.externals,
            output: {
                exports: 'named',
                preserveModules: true,
                preserveModulesRoot: 'src',
                format: 'esm',
                entryFileNames: '[name].es.js',
                sourcemapExcludeSources: false,
            },
        },
        sourcemap: true,
        minify: false,
        emptyOutDir: true,
    },
    plugins: [
        tsConfigPaths(),
        dts({
            tsconfigPath: './tsconfig.build.json',
            outDir: 'dist',
            entryRoot: 'src',
            include: ['src/**/*.ts'],
            rollupTypes: false,
            insertTypesEntry: false,
        }),
    ],
});
