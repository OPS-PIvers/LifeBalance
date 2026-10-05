// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { entryScriptOf, isUpdateAvailable, runningEntryScript } from './wallVersion';

const HTML = `<!doctype html><html><head>
<link rel="modulepreload" crossorigin href="/assets/vendor-react-Xy9.js">
<script type="module" crossorigin src="/assets/index-AbC123.js"></script>
</head><body></body></html>`;

describe('entryScriptOf', () => {
  it('finds the hashed entry script', () => {
    expect(entryScriptOf(HTML)).toBe('/assets/index-AbC123.js');
  });

  it('accepts an absolute URL and attribute order changes', () => {
    expect(entryScriptOf('<script src="https://app.example/assets/index-Q.js" type="module"></script>')).toBe('/assets/index-Q.js');
    expect(entryScriptOf('<script type="module" src="https://app.example/assets/index-Q.js"></script>')).toBe('/assets/index-Q.js');
  });

  it('is null for a dev page or junk', () => {
    expect(entryScriptOf('<script type="module" src="/index.tsx"></script>')).toBeNull();
    expect(entryScriptOf('')).toBeNull();
  });
});

describe('runningEntryScript', () => {
  it('reads the page’s own module script', () => {
    document.head.innerHTML = '<script type="module" src="/assets/index-Old1.js"></script>';
    expect(runningEntryScript(document)).toBe('/assets/index-Old1.js');
    document.head.innerHTML = '';
    expect(runningEntryScript(document)).toBeNull();
  });
});

describe('isUpdateAvailable', () => {
  it('only when both are known and differ', () => {
    expect(isUpdateAvailable('/assets/index-A.js', '/assets/index-B.js')).toBe(true);
    expect(isUpdateAvailable('/assets/index-A.js', '/assets/index-A.js')).toBe(false);
    expect(isUpdateAvailable(null, '/assets/index-B.js')).toBe(false);
    expect(isUpdateAvailable('/assets/index-A.js', null)).toBe(false);
  });
});
