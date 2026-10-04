import { describe, expect, it } from 'vitest';
import prototypeHtml from '@/docs/plans/wall-display-prototype.html?raw';
import { buildPrototypeDoc } from './labSupport';

describe('buildPrototypeDoc', () => {
  const doc = buildPrototypeDoc(prototypeHtml, 'https://lab.example');

  it('swaps Google Fonts for the self-hosted files', () => {
    expect(doc).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(doc).toContain("url('https://lab.example/fonts/besley-latin.woff2')");
    expect(doc).toContain("url('https://lab.example/fonts/schibsted-grotesk-latin.woff2')");
  });

  it('hides the prototype chrome but keeps its toggles in the DOM', () => {
    expect(doc).toContain('.head, .chips, .toggles, .notes { display: none !important; }');
    expect(doc).toContain('data-t="theme" data-v="dark"');
  });
});
