import { describe, it, expect } from 'vitest';
import {
  groupLineItemsByCategory,
  buildLineItemTransactions,
  shouldSplitReceipt,
  looksLikeTransactionList,
} from '@/utils/receiptLineItems';
import type { ReceiptLineItemsData } from '@/services/geminiService.types';

describe('groupLineItemsByCategory', () => {
  it('sums amounts per category, cent-safe', () => {
    const groups = groupLineItemsByCategory([
      { description: 'Milk', amount: 3.5, category: 'Groceries' },
      { description: 'Sponge', amount: 2.25, category: 'Household' },
      { description: 'Eggs', amount: 4.15, category: 'Groceries' },
    ]);
    expect(groups).toEqual([
      { category: 'Groceries', amount: 7.65 },
      { category: 'Household', amount: 2.25 },
    ]);
  });

  it('avoids float drift when summing (0.1 + 0.2)', () => {
    const groups = groupLineItemsByCategory([
      { description: 'A', amount: 0.1, category: 'Groceries' },
      { description: 'B', amount: 0.2, category: 'Groceries' },
    ]);
    expect(groups).toEqual([{ category: 'Groceries', amount: 0.3 }]);
  });

  it('preserves first-seen category order', () => {
    const groups = groupLineItemsByCategory([
      { description: 'A', amount: 1, category: 'Household' },
      { description: 'B', amount: 1, category: 'Groceries' },
      { description: 'C', amount: 1, category: 'Household' },
    ]);
    expect(groups.map(g => g.category)).toEqual(['Household', 'Groceries']);
  });

  it('drops categories whose total is not strictly positive', () => {
    const groups = groupLineItemsByCategory([
      { description: 'Refund', amount: 0, category: 'Groceries' },
      { description: 'Real', amount: 5, category: 'Household' },
    ]);
    expect(groups).toEqual([{ category: 'Household', amount: 5 }]);
  });

  it('falls back to "Other" for blank categories', () => {
    const groups = groupLineItemsByCategory([
      { description: 'A', amount: 2, category: '' },
    ]);
    expect(groups).toEqual([{ category: 'Other', amount: 2 }]);
  });
});

describe('shouldSplitReceipt', () => {
  const base: Omit<ReceiptLineItemsData, 'items'> = { merchant: 'Target' };

  it('is true with two positive category groups', () => {
    expect(shouldSplitReceipt({
      ...base,
      items: [
        { description: 'Milk', amount: 3, category: 'Groceries' },
        { description: 'Soap', amount: 2, category: 'Household' },
      ],
    })).toBe(true);
  });

  it('is false with a single category', () => {
    expect(shouldSplitReceipt({
      ...base,
      items: [
        { description: 'Milk', amount: 3, category: 'Groceries' },
        { description: 'Eggs', amount: 2, category: 'Groceries' },
      ],
    })).toBe(false);
  });

  it('is false with no items', () => {
    expect(shouldSplitReceipt({ ...base, items: [] })).toBe(false);
  });
});

describe('buildLineItemTransactions', () => {
  const data: ReceiptLineItemsData = {
    merchant: '  Target  ',
    date: '2026-07-14',
    store: '  Target Store  ',
    items: [
      { description: 'Milk', amount: 3.5, category: 'Groceries' },
      { description: 'Soap', amount: 2.25, category: 'Household' },
      { description: 'Eggs', amount: 4.15, category: 'Groceries' },
    ],
  };

  it('produces one transaction per category with shared group id, merchant, date, store', () => {
    let n = 0;
    const txns = buildLineItemTransactions(data, 'grp-1', () => `id-${n++}`);
    expect(txns).toEqual([
      {
        id: 'id-0',
        merchant: 'Target',
        amount: 7.65,
        category: 'Groceries',
        date: '2026-07-14',
        selected: true,
        store: 'Target Store',
        receiptGroupId: 'grp-1',
      },
      {
        id: 'id-1',
        merchant: 'Target',
        amount: 2.25,
        category: 'Household',
        date: '2026-07-14',
        selected: true,
        store: 'Target Store',
        receiptGroupId: 'grp-1',
      },
    ]);
  });

  it('leaves store undefined when the receipt had no store', () => {
    const txns = buildLineItemTransactions(
      { merchant: 'Shop', date: '2026-07-14', items: [{ description: 'X', amount: 1, category: 'Groceries' }] },
      'grp-2',
      () => 'id',
    );
    expect(txns[0]?.store).toBeUndefined();
  });
});

describe('looksLikeTransactionList', () => {
  // Verbatim rows from a Wells Fargo account-activity screenshot — the image
  // that was being itemized as a receipt and summed into two lump transactions.
  const wellsFargoRows = [
    { description: 'AMERICAN EXPRESS ACH PMT 260727 M6896', amount: 100, category: 'Other' },
    { description: 'PURCHASE PRIME VIDEO 888-802-3080 WA CARD7752', amount: 5.42, category: 'Entertainment' },
    { description: 'PURCHASE JIMMY JOHNS MINNEAPOLIS MN CARD7752', amount: 35.95, category: 'Dining' },
    { description: 'PURCHASE AUTHORIZED ON 07/22 AMAZON RETA* GM1MH CARD 7752', amount: 9.97, category: 'Shopping' },
    { description: 'RECURRING PAYMENT AUTHORIZED ON 07/22 GOOGLE *GOOGLE ONE', amount: 19.99, category: 'Other' },
    { description: 'SAVE AS YOU GO TRANSFER DEBIT TO XXXXXXXXXX9294', amount: 1, category: 'Other' },
  ];

  it('flags a bank transaction list the model mislabeled as a receipt', () => {
    expect(looksLikeTransactionList(wellsFargoRows)).toBe(true);
  });

  it('leaves a real grocery receipt alone', () => {
    expect(looksLikeTransactionList([
      { description: 'Bananas', amount: 1.29, category: 'Groceries' },
      { description: '2% Milk Gallon', amount: 4.29, category: 'Groceries' },
      { description: 'Dish Sponge 3pk', amount: 2.25, category: 'Household' },
      { description: 'Cheddar Cheese Block', amount: 5.49, category: 'Groceries' },
    ])).toBe(false);
  });

  it('needs two matches AND half the items, so one odd product name cannot flip a receipt', () => {
    // "Gift Card 4 pack" trips the card pattern; everything else is a product.
    expect(looksLikeTransactionList([
      { description: 'Visa Gift Card 4000', amount: 40, category: 'Shopping' },
      { description: 'Bananas', amount: 1.29, category: 'Groceries' },
      { description: '2% Milk Gallon', amount: 4.29, category: 'Groceries' },
      { description: 'Bread', amount: 3.49, category: 'Groceries' },
    ])).toBe(false);
  });

  it('never flips on a single item (a one-line receipt is common)', () => {
    expect(looksLikeTransactionList([
      { description: 'PURCHASE AUTHORIZED ON 07/22 TARGET CARD 7752', amount: 40, category: 'Shopping' },
    ])).toBe(false);
  });

  it('handles an empty list', () => {
    expect(looksLikeTransactionList([])).toBe(false);
  });
});
