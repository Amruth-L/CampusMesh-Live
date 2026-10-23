module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', require: 'readonly', module: 'readonly', exports: 'readonly', setTimeout: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' } },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], 'no-undef': 'error', 'no-constant-condition': 'warn' },
  },
];
