import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  // `prodbundle*.js` is a saved copy of a DEPLOYED bundle, kept at the repo root
  // while somebody reads what shipped. It is build output like `dist/`, and it is
  // listed here as well as in `.gitignore` because **flat config never consults
  // `.gitignore`** — measured: with the ignore rule in place and this line absent,
  // `npm run lint` still reported 137 errors in that one file.
  //
  // That asymmetry is why the local gate and CI disagreed. `eslint .` linted a
  // 425KB minified bundle that exists only on the machine that downloaded it, so
  // lint failed locally and passed in CI on the same commit — the shape cairn
  // records as a local gate running a different graph. Both lists are needed and
  // neither tool reads the other's.
  { ignores: ['dist', 'dev-dist', 'node_modules', 'coverage', 'prodbundle*.js'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // The new JSX transform means React need not be in scope.
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.node } },
  },
]
