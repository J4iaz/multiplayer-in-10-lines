'use strict';

module.exports = [
  {
    ignores: ['node_modules/**', 'public/vendor/**', 'public/multiplayer.js'],
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        globalThis: 'readonly',
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        history: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Multiplayer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
];
