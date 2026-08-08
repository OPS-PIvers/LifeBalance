export interface ParsedTransaction {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  date: string;
  selected: boolean;
  relatedHabitIds?: string[];
  store?: string;
  accountId?: string;
  creditPayment?: boolean;
  /** F-DASH-04: set on rows that came from splitting ONE receipt into several
   *  categorized line-item transactions. Every row from the same scan shares
   *  this id and it is carried onto each resulting `Transaction.receiptGroupId`
   *  so the list can group them back into the original purchase. Absent on
   *  ordinary single-transaction / bank-statement rows. */
  receiptGroupId?: string;
  /** The bank's verbatim row text from a statement-scan capture, carried onto
   *  the created `Transaction.bankDescriptor` for identity matching. Absent
   *  when the AI didn't return one (or for a non-statement-scan row). */
  bankDescriptor?: string;
}
