// .eslintrc.cjs
//
// ESLint configuration for the Safexpr project.
// - TypeScript-first
// - Node + browser compatible library
// - Vitest for tests
// - Prettier for formatting (no style bikeshedding in ESLint)

module.exports = {
  root: true,

  env: {
    es2021: true,
    node: true,
    browser: false, // core library is mostly runtime-agnostic
  },

  parser: '@typescript-eslint/parser',

  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    // If you want type-aware lint rules, uncomment the next two lines
    // and ensure tsconfig.json is correctly configured.
    // project: ['./tsconfig.json'],
    // tsconfigRootDir: __dirname,
  },

  plugins: ['@typescript-eslint', 'import'],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier', // always keep "prettier" last
  ],

  settings: {
    'import/resolver': {
      // Use TS paths (e.g. "@/core/engine") and Node resolution
      typescript: {
        alwaysTryTypes: true,
        project: './tsconfig.json',
      },
      node: {
        extensions: ['.js', '.mjs', '.cjs', '.ts', '.d.ts', '.tsx'],
      },
    },
  },

  rules: {
    // -----------------------------
    // General JS / TS best practices
    // -----------------------------
    'no-var': 'error',
    'prefer-const': [
      'error',
      {
        destructuring: 'all',
        ignoreReadBeforeAssign: true,
      },
    ],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-unused-vars': 'off', // use TS version below
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'no-console': [
      'warn',
      {
        allow: ['warn', 'error'],
      },
    ],
    'no-debugger': 'warn',
    'no-duplicate-imports': 'error',

    // -----------------------------
    // TypeScript
    // -----------------------------
    '@typescript-eslint/explicit-module-boundary-types': 'off', // too verbose for many APIs
    '@typescript-eslint/ban-ts-comment': [
      'warn',
      {
        'ts-ignore': 'allow-with-description',
      },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      {
        prefer: 'type-imports',
        disallowTypeAnnotations: false,
      },
    ],

    // -----------------------------
    // Imports
    // -----------------------------
    'import/order': [
      'warn',
      {
        groups: [
          'builtin', // fs, path, etc.
          'external', // npm deps
          'internal', // "@/core/..."
          ['parent', 'sibling', 'index'],
          'type',
        ],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-unresolved': 'error',
    'import/no-default-export': 'off', // libraries often use default exports
    'import/newline-after-import': ['warn', { count: 1 }],
  },

  overrides: [
    // -----------------------------
    // Source (TS) files
    // -----------------------------
    {
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      env: {
        browser: false,
      },
      rules: {
        // Keep core library code clean and strict
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },

    // -----------------------------
    // React / JSX integrations (if any)
    // -----------------------------
    {
      files: ['src/**/*.{tsx,jsx}', 'examples/**/*.{tsx,jsx}'],
      env: {
        browser: true,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      rules: {
        // JSX-specific tuning can go here if needed
      },
    },

    // -----------------------------
    // Test files
    // -----------------------------
    {
      files: ['tests/**/*.ts', 'tests/**/*.tsx'],
      env: {
        node: true,
        'vitest/globals': true,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-console': 'off',
      },
    },

    // -----------------------------
    // Config / scripts
    // -----------------------------
    {
      files: [
        '*.config.*',
        'scripts/**/*.ts',
        'scripts/**/*.js',
        'rollup.config.*',
        'vitest.config.*',
      ],
      env: {
        node: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
