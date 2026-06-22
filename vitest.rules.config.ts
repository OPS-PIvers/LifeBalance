/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Separate Vitest config for Firestore Security Rules tests.
//
// These tests run against the Firestore emulator — launched by the
// `pnpm test:rules` script via `firebase emulators:exec` — in a Node
// environment, NOT jsdom. They are deliberately kept out of the default
// `vitest run` (which has no emulator running); the main config in
// vite.config.ts excludes `tests/rules/**` for the same reason.
//
// Run them with:  pnpm test:rules
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // Booting the emulator connection and clearing data between tests can
    // exceed Vitest's 5s default; give the suite generous head-room.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
