
import { describe, it, expect } from 'vitest';
import { sanitizeFirestoreData, MAX_FIRESTORE_STRING_LENGTH } from './firestoreSanitizer';

describe('sanitizeFirestoreData', () => {
  it('converts undefined values to null', () => {
    const input = { a: 1, b: undefined, c: 'test' };
    const output = sanitizeFirestoreData(input);
    expect(output).toEqual({ a: 1, b: null, c: 'test' });
  });

  it('trims strings', () => {
    const input = { name: '  test  ' };
    const output = sanitizeFirestoreData(input);
    expect(output).toEqual({ name: 'test' });
  });

  it('converts empty strings to null', () => {
    const input = { name: '   ' };
    const output = sanitizeFirestoreData(input);
    expect(output).toEqual({ name: null });
  });

  it('handles nested objects', () => {
    const input = { user: { name: ' test ', age: undefined } };
    const output = sanitizeFirestoreData(input);
    expect(output).toEqual({ user: { name: 'test', age: null } });
  });

  it('handles arrays', () => {
    const input = { tags: [' a ', undefined, 'b'] };
    const output = sanitizeFirestoreData(input);
    expect(output).toEqual({ tags: ['a', null, 'b'] });
  });

  it('preserves Dates and Timestamps', () => {
    const date = new Date();
    const timestamp = { seconds: 123, nanoseconds: 456 };
    const input = { created: date, updated: timestamp };
    const output = sanitizeFirestoreData(input);
    expect(output).toEqual(input);
  });

  it('truncates strings exceeding the maximum length', () => {
    const longString = 'a'.repeat(MAX_FIRESTORE_STRING_LENGTH + 100);
    const expectedString = 'a'.repeat(MAX_FIRESTORE_STRING_LENGTH);
    const input = { notes: longString };
    const output = sanitizeFirestoreData(input);
    expect(output.notes).toHaveLength(MAX_FIRESTORE_STRING_LENGTH);
    expect(output.notes).toBe(expectedString);
  });

  it('preserves strings exactly at the maximum length', () => {
    const exactString = 'a'.repeat(MAX_FIRESTORE_STRING_LENGTH);
    const input = { notes: exactString };
    const output = sanitizeFirestoreData(input);
    expect(output.notes).toHaveLength(MAX_FIRESTORE_STRING_LENGTH);
    expect(output.notes).toBe(exactString);
  });
});
