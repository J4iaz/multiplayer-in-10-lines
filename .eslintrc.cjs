'use strict';
module.exports = {
  env: { node: true, browser: true, es2020: true },
  parserOptions: { ecmaVersion: 2020 },
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
  },
  ignorePatterns: ['node_modules/', 'public/vendor/', 'public/multiplayer.js'],
};
