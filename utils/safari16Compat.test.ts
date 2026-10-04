import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The wall display is a 1st-gen iPad Pro capped at iPadOS 16, and some sit on
 * 16.2. Safari before 16.4 rejects a regex lookbehind (`(?<=` / `(?<!`) as a
 * SyntaxError when the chunk PARSES, so one in a boot-path module blanks the
 * whole app. Build tools can't transpile it away, so keep it out of client
 * code.
 */
const ROOT = join(__dirname, '..');
// Everything the app bundle can import (not functions/, e2e/, tests/ or build config).
const SCAN = ['App.tsx', 'index.tsx', 'firebase.config.ts', 'components', 'contexts', 'data', 'hooks', 'pages', 'services', 'src', 'types', 'utils'];
// Regex text shown to the user for their own iOS Shortcut, never run here.
const ALLOWED = new Set(['components/settings/ShortcutSetupGuide.tsx']);

function sourceFiles(path: string): string[] {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap(name => (name === 'node_modules' ? [] : sourceFiles(join(path, name))));
}

describe('Safari 16.2 compatibility', () => {
  it('client code has no regex lookbehind', () => {
    const offenders = SCAN.flatMap(p => sourceFiles(join(ROOT, p)))
      .map(file => relative(ROOT, file).split('\\').join('/'))
      .filter(file => !ALLOWED.has(file))
      .filter(file => /\(\?<[=!]/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
