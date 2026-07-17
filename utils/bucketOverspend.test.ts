import { describe, it, expect } from 'vitest';
import { getBucketOverspend, getBucketsOverspendSummary } from '@/utils/bucketOverspend';

describe('getBucketOverspend', () => {
  it('reports an under-budget bucket as not overspent', () => {
    const r = getBucketOverspend({ verified: 200, pending: 50 }, 500);
    expect(r.committed).toBe(250);
    expect(r.isOverspent).toBe(false);
    expect(r.overage).toBe(0);
    expect(r.percent).toBe(50);
  });

  it('counts pending toward committed spend', () => {
    const r = getBucketOverspend({ verified: 480, pending: 40 }, 500);
    expect(r.committed).toBe(520);
    expect(r.isOverspent).toBe(true);
    expect(r.overage).toBe(20);
    expect(r.percent).toBe(100);
  });

  it('computes the overage exactly to the cent', () => {
    const r = getBucketOverspend({ verified: 523.45, pending: 0 }, 500);
    expect(r.isOverspent).toBe(true);
    expect(r.overage).toBe(23.45);
  });

  it('avoids floating-point drift when summing verified + pending', () => {
    const r = getBucketOverspend({ verified: 0.1, pending: 0.2 }, 1);
    expect(r.committed).toBe(0.3);
    expect(r.isOverspent).toBe(false);
  });

  it('treats spend exactly at the limit as not overspent', () => {
    const r = getBucketOverspend({ verified: 500, pending: 0 }, 500);
    expect(r.isOverspent).toBe(false);
    expect(r.overage).toBe(0);
    expect(r.percent).toBe(100);
  });

  it('caps the percent at 100 when overspent', () => {
    const r = getBucketOverspend({ verified: 1500, pending: 0 }, 500);
    expect(r.percent).toBe(100);
  });

  it('treats a zero-limit pseudo-bucket with spend as fully filled but reports its overage', () => {
    const r = getBucketOverspend({ verified: 80, pending: 0 }, 0);
    expect(r.isOverspent).toBe(true);
    expect(r.overage).toBe(80);
    expect(r.percent).toBe(100);
  });

  it('reports an empty zero-limit bucket as 0%', () => {
    const r = getBucketOverspend({ verified: 0, pending: 0 }, 0);
    expect(r.isOverspent).toBe(false);
    expect(r.percent).toBe(0);
  });
});

describe('getBucketsOverspendSummary', () => {
  it('sums overage only from over-budget, positive-limit buckets', () => {
    const summary = getBucketsOverspendSummary([
      { spent: { verified: 520, pending: 0 }, limit: 500 }, // +20
      { spent: { verified: 100, pending: 0 }, limit: 300 }, // under
      { spent: { verified: 150, pending: 30 }, limit: 100 }, // +80
    ]);
    expect(summary.overspentCount).toBe(2);
    expect(summary.totalOverage).toBe(100);
  });

  it('ignores zero-limit buckets so an unbudgeted pool never inflates the total', () => {
    const summary = getBucketsOverspendSummary([
      { spent: { verified: 400, pending: 0 }, limit: 0 }, // no budget
      { spent: { verified: 620, pending: 0 }, limit: 600 }, // +20
    ]);
    expect(summary.overspentCount).toBe(1);
    expect(summary.totalOverage).toBe(20);
  });

  it('returns zero when nothing is overspent', () => {
    const summary = getBucketsOverspendSummary([
      { spent: { verified: 10, pending: 0 }, limit: 500 },
    ]);
    expect(summary.overspentCount).toBe(0);
    expect(summary.totalOverage).toBe(0);
  });

  it('sums overages exactly to the cent', () => {
    const summary = getBucketsOverspendSummary([
      { spent: { verified: 510.1, pending: 0 }, limit: 500 }, // +10.10
      { spent: { verified: 200.2, pending: 0 }, limit: 200 }, // +0.20
    ]);
    expect(summary.totalOverage).toBe(10.3);
  });
});
