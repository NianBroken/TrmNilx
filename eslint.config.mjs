import js from '@eslint/js';
import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      'no-console': 'off'
    }
  },
  {
    ignores: [
      'dist/**',
      '*.vsix'
    ]
  }
];
