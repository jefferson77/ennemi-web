// Flat ESLint config for ennemi-web. Prettier owns formatting; eslint-config-prettier comes
// last so no stylistic rule survives to fight it.
import js from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  {
    name: 'ennemi-web/browser',
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    name: 'ennemi-web/node',
    files: ['scripts/**/*.{js,mjs}', 'server/**/*.js', '*.config.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  prettierConfig,
];
