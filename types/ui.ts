export interface ParsedTransaction {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  date: string;
  selected: boolean;
  relatedHabitIds?: string[];
  subBucketId?: string;
}

export type ModalTab = 'transaction' | 'todo' | 'shopping';

export interface ManualInitialData {
  amount?: string;
  merchant?: string;
  category?: string;
  date?: string;
  subBucketId?: string;
}

export interface TodoInitialData {
  text?: string;
  completeByDate?: string;
  assignedTo?: string;
}

export interface ShoppingInitialData {
  name?: string;
  category?: string;
  quantity?: string;
  store?: string;
}
