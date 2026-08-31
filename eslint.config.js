// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['src/**/*.js', 'dist/**'] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      eqeqeq: 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'local',
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/class-literal-property-style': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1, 2],
          ignoreReadonlyClassProperties: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  {
    // `scripts/` sits outside the root tsconfig's `include`, so the project
    // service finds no project for a harness and types every DOM symbol in it as
    // unresolved. `tsconfig.scripts.json` is the project those files are
    // typechecked under, and it is the one the linter has to read them through.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.scripts.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Pixel-art sprite and tile drawing functions are coordinate-heavy by nature.
    // The numbers there are art geometry, not semantic game constants.
    // `src/map/tilegen/` is the same category one level down: material painters,
    // palette ramps and noise lattices, whose numbers are the art itself.
    files: ['src/sprites/**/*.ts', 'src/map/tiles/**/*.ts', 'src/map/tilegen/**/*.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    // A generated list of opaque 32-bit seeds. Each is the identity of one
    // verified look, meaningful only as itself; naming a hundred and twenty
    // eight of them would replace a table the builder writes with a table
    // nobody maintains. `npm run gen:ground-art-seeds` owns this file.
    files: ['src/map/ground/artSeedAlphabet.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    // The Big Top's maze is an authored floor plan, and the plan is drawn out in
    // the same file as an ASCII grid. Every bare number in it is a tile
    // coordinate read off that grid; naming each one would replace a table you
    // can check against the picture above it with forty aliases you cannot. The
    // file's *timings* are all named constants, which is where the rule earns
    // its keep and where it is still being followed.
    files: ['src/map/bigTopMazeLayout.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
);
