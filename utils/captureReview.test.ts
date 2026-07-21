import { describe, it, expect } from 'vitest';
import type { Household, CaptureType } from '@/types/schema';
import { getCaptureReviewMode, isManualReview } from './captureReview';

/** Build the minimal settings shape the capture-review helpers read. */
const settings = (
  captureReview?: Household['captureReview'],
): Pick<Household, 'captureReview'> => ({ captureReview });

const ALL_TYPES: CaptureType[] = ['expense', 'shopping', 'todo'];

describe('getCaptureReviewMode (per-type defaults)', () => {
  it('treats null settings as the per-type default', () => {
    expect(getCaptureReviewMode(null, 'expense')).toBe('review');
    expect(getCaptureReviewMode(null, 'shopping')).toBe('auto');
    expect(getCaptureReviewMode(null, 'todo')).toBe('auto');
  });

  it('treats undefined settings as the per-type default', () => {
    expect(getCaptureReviewMode(undefined, 'expense')).toBe('review');
    expect(getCaptureReviewMode(undefined, 'shopping')).toBe('auto');
    expect(getCaptureReviewMode(undefined, 'todo')).toBe('auto');
  });

  it('treats an absent captureReview field as the per-type default (legacy household)', () => {
    expect(getCaptureReviewMode(settings(undefined), 'expense')).toBe('review');
    expect(getCaptureReviewMode(settings(undefined), 'shopping')).toBe('auto');
    expect(getCaptureReviewMode(settings(undefined), 'todo')).toBe('auto');
  });

  it('treats an empty captureReview map as the per-type default', () => {
    expect(getCaptureReviewMode(settings({}), 'expense')).toBe('review');
    expect(getCaptureReviewMode(settings({}), 'shopping')).toBe('auto');
    expect(getCaptureReviewMode(settings({}), 'todo')).toBe('auto');
  });

  it('an explicit override for one type wins, leaving the others at default', () => {
    const s = settings({ expense: 'auto' });
    expect(getCaptureReviewMode(s, 'expense')).toBe('auto');
    // shopping/todo absent from the partial map -> still their own defaults
    expect(getCaptureReviewMode(s, 'shopping')).toBe('auto');
    expect(getCaptureReviewMode(s, 'todo')).toBe('auto');
  });

  it('honors an explicit "review" override on a type that defaults to "auto"', () => {
    expect(getCaptureReviewMode(settings({ shopping: 'review' }), 'shopping')).toBe('review');
    expect(getCaptureReviewMode(settings({ todo: 'review' }), 'todo')).toBe('review');
  });

  it('honors an explicit "auto" override on a type that defaults to "review"', () => {
    expect(getCaptureReviewMode(settings({ expense: 'auto' }), 'expense')).toBe('auto');
  });

  it('every type can be overridden independently in the same map', () => {
    const s = settings({ expense: 'auto', shopping: 'review', todo: 'review' });
    expect(getCaptureReviewMode(s, 'expense')).toBe('auto');
    expect(getCaptureReviewMode(s, 'shopping')).toBe('review');
    expect(getCaptureReviewMode(s, 'todo')).toBe('review');
  });
});

describe('isManualReview', () => {
  it('matches getCaptureReviewMode === "review" for every type/setting combination', () => {
    for (const type of ALL_TYPES) {
      expect(isManualReview(null, type)).toBe(getCaptureReviewMode(null, type) === 'review');
      expect(isManualReview(settings({ [type]: 'review' }), type)).toBe(true);
      expect(isManualReview(settings({ [type]: 'auto' }), type)).toBe(false);
    }
  });

  it('reflects the legacy default per type when unset', () => {
    expect(isManualReview(settings(undefined), 'expense')).toBe(true);
    expect(isManualReview(settings(undefined), 'shopping')).toBe(false);
    expect(isManualReview(settings(undefined), 'todo')).toBe(false);
  });
});
