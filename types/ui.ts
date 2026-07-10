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
}
