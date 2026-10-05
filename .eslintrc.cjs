module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  plugins: ['react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', 'backend/node_modules', 'contoh-web-Invoice', '*.config.js', '.eslintrc.cjs'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^node$' }],
    'react/prop-types': 'off',
  },
  overrides: [
    {
      files: ['backend/**/*.js'],
      env: { node: true, browser: false },
      parserOptions: { sourceType: 'script' },
      rules: {
        'react/react-in-jsx-scope': 'off',
      },
    },
  ],
};
