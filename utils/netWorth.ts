/**
 * Net worth math (F-MONEY-09).
 *
 * Mirrors the live calculation already inlined in `BudgetAccounts.tsx`
 * (`assetAccounts`/`liabilityAccounts`/`netWorth`), extracted to a pure,
 * unit-tested helper so it can also be used server-side by the daily
 * `snapshotnetworth` scheduled function (`functions/src/netWorth/index.ts`
 * keeps its own duplicated copy per the `functions/src/entitlements.ts`
 * documented-duplication pattern — `functions/` is a separate pnpm package
 * and cannot import from the root `utils/`).
 *
 * `credit` accounts are liabilities; `checking`/`savings` are assets. Money is
 * summed in integer cents via `sumMoney`/`subtractMoney` to avoid float drift,
 * but inputs/outputs are decimal dollars (see CLAUDE.md Safe-to-Spend notes).
 */

import { sumMoney, subtractMoney } from '@/utils/money';

export interface NetWorthAccountLike {
  type: 'checking' | 'savings' | 'credit';
  balance: number;
}

export interface NetWorthTotals {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * Computes total assets, total liabilities, and net worth from a household's
 * accounts. Liability balances are stored/entered as positive numbers (the
 * amount owed), so `totalLiabilities` is the sum of credit-account balances
 * and `netWorth` subtracts it from `totalAssets`.
 */
export function computeNetWorth(accounts: NetWorthAccountLike[]): NetWorthTotals {
  const totalAssets = sumMoney(accounts.filter(a => a.type !== 'credit').map(a => a.balance));
  const totalLiabilities = sumMoney(accounts.filter(a => a.type === 'credit').map(a => a.balance));
  return {
    totalAssets,
    totalLiabilities,
    netWorth: subtractMoney(totalAssets, totalLiabilities),
  };
}
