import { describe, expect, it } from 'vitest';
import { looksLikeBankDescriptor } from '@/utils/bankDescriptor';

describe('looksLikeBankDescriptor', () => {
  it.each([
    ['AMERICAN EXPRESS ACH PMT', true, 'all-caps with no trailing noise'],
    ['AMEX ACH PAYMENT', true, 'the motivating example — caps is the only signal'],
    ['APPLE.COM/BILL 866-712-7753 CA', true, 'all-caps with digits'],
    ['sq *blue bottle', true, 'lowercase but carries a processor marker'],
    ['7-Eleven 22371', true, 'mixed case with digits'],
    ['AMZN Mktp#1A2B3', true, 'mixed case with a # marker'],
    ['CAFÉ MÜLLER', true, 'accented all-caps still reads as caps'],
    ['Target', false, 'a name someone typed'],
    ["Trader Joe's", false, 'an apostrophe is not a descriptor marker'],
    ['Coffee', false, 'a hand-entered merchant'],
    ['Whole Foods Market', false, 'title case, multi-word'],
    ['', false, 'blank'],
    ['A', false, 'too short to judge'],
    ['   ', false, 'whitespace only'],
  ])('%s → %s (%s)', (merchant, expected) => {
    expect(looksLikeBankDescriptor(merchant)).toBe(expected);
  });

  it('does not treat a single capital letter as all-caps', () => {
    // Guards the `letters.length >= 2` floor: without it, "A1" and similar
    // one-letter strings would qualify on the caps test alone.
    expect(looksLikeBankDescriptor('A b')).toBe(false);
  });

  it('judges caps on letters only, ignoring digits and punctuation', () => {
    // "76 GAS" has a leading number; the letters are still all-caps.
    expect(looksLikeBankDescriptor('76 GAS')).toBe(true);
  });
});
