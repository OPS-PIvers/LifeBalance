import { describe, expect, it } from 'vitest';
import { getTemplateTint, templateTintClasses } from '@/components/todos/todoDisplay';

describe('getTemplateTint', () => {
  it('resolves every legacy STORE_COLORS key to a tint', () => {
    const legacyKeys = ['red', 'pink', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'gray'];
    for (const key of legacyKeys) {
      expect(getTemplateTint(key)).toEqual(
        expect.objectContaining({ bg: expect.any(String), text: expect.any(String), border: expect.any(String) })
      );
    }
  });

  it('maps warm-family legacy colors to the amber tint', () => {
    expect(getTemplateTint('orange')).toEqual(templateTintClasses.amber);
    expect(getTemplateTint('amber')).toEqual(templateTintClasses.amber);
  });

  it('maps red/pink legacy colors to the rose tint', () => {
    expect(getTemplateTint('red')).toEqual(templateTintClasses.rose);
    expect(getTemplateTint('pink')).toEqual(templateTintClasses.rose);
  });

  it('falls back to neutral for an unknown color key', () => {
    expect(getTemplateTint('mystery-color')).toEqual(templateTintClasses.neutral);
  });

  it('falls back to neutral for an undefined color key', () => {
    expect(getTemplateTint(undefined)).toEqual(templateTintClasses.neutral);
  });
});
