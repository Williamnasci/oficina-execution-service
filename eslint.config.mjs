import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  { ...js.configs.recommended, files: ['src/**/*.mjs'], languageOptions: { globals: globals.node } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['src/**/*.ts'] })),
  { files: ['src/**/*.{ts,mjs}'], plugins: { sonarjs }, rules: {
    'sonarjs/no-identical-expressions': 'error', 'sonarjs/no-all-duplicated-branches': 'error',
    'sonarjs/no-duplicated-branches': 'error', 'sonarjs/no-element-overwrite': 'error',
    'sonarjs/no-identical-conditions': 'error', 'sonarjs/no-extra-arguments': 'error',
    'sonarjs/no-use-of-empty-return-value': 'error', 'sonarjs/no-gratuitous-expressions': 'error',
    'sonarjs/no-inverted-boolean-check': 'error', 'sonarjs/no-collapsible-if': 'error',
    'no-eval': 'error', 'no-implied-eval': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  } },
];
