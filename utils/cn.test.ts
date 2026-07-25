import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges conflicting utilities, last one winning', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-brand-600', 'text-accent-700')).toBe('text-accent-700');
  });

  it('drops falsy values and flattens nested arrays', () => {
    expect(cn('a', undefined, null, false, ['c', ''])).toBe('a c');
  });

  // The custom `--text-xxs` token from index.css's @theme block is registered
  // with tailwind-merge as a font-size (see cn.ts). Without that registration
  // it falls into the text-COLOUR group and is treated as conflicting with the
  // colour utilities, so one of the two gets dropped depending on argument
  // order — which silently stripped the variant colour from every
  // `<Badge size="sm">` and the size from every `<Eyebrow size="xxs">`.
  describe('custom text-xxs font-size token', () => {
    it('does not conflict with a text colour, in either order', () => {
      expect(cn('text-money-neg', 'text-xxs px-2 py-0.5')).toBe(
        'text-money-neg text-xxs px-2 py-0.5'
      );
      expect(cn('text-xxs', 'text-brand-600')).toBe('text-xxs text-brand-600');
    });

    it('still conflicts with other font sizes, last one winning', () => {
      expect(cn('text-xs', 'text-xxs')).toBe('text-xxs');
      expect(cn('text-xxs', 'text-sm')).toBe('text-sm');
    });

    it('keeps the size while a later colour overrides an earlier one', () => {
      // Badge's real shape: base, variant colour, size, caller className.
      expect(cn('text-accent-700', 'text-xxs px-2 py-0.5', 'gap-1 text-habit-blue')).toBe(
        'text-xxs px-2 py-0.5 gap-1 text-habit-blue'
      );
    });

    it('does not disturb dark: variants of the same properties', () => {
      expect(cn('text-xxs', 'text-brand-500 dark:text-brand-400')).toBe(
        'text-xxs text-brand-500 dark:text-brand-400'
      );
    });
  });
});
