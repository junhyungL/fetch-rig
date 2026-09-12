import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A runtime "did you forget to await next()?" guard in compose.ts was tried and removed —
      // see docs/ARCHITECTURE.md's Middleware system section for why. These two rules are the
      // actual fix: catching a missing await statically instead of at runtime.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Test assertions on `unknown` (e.g. caught errors) are routinely narrowed with `as`.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // Mock Dispatch/middleware implementations must be async to satisfy the Promise<void>
      // return type even when the mock body has nothing to await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['*.config.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
