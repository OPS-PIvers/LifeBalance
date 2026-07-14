/**
 * Server-side copy of `utils/netWorth.ts`'s `computeNetWorth` (F-MONEY-09).
 *
 * `functions/` is a separate pnpm package and cannot import from the root
 * `utils/`, so this pure helper is duplicated here — same documented pattern
 * as `functions/src/entitlements.ts`. Keep in sync with `utils/netWorth.ts`
 * and `utils/money.ts`'s `sumMoney`/`subtractMoney` if the money math changes.
 */

export interface NetWorthAccountLike {
  type: "checking" | "savings" | "credit";
  balance: number;
}

export interface NetWorthTotals {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/** Sum dollar amounts exactly by accumulating in integer cents (mirrors `utils/money.ts#sumMoney`). */
function sumMoney(amounts: number[]): number {
  return amounts.reduce((cents, amount) => cents + Math.round(amount * 100), 0) / 100;
}

/** Subtract `b` from `a` exactly (mirrors `utils/money.ts#subtractMoney`). */
function subtractMoney(a: number, b: number): number {
  return (Math.round(a * 100) - Math.round(b * 100)) / 100;
}

export function computeNetWorth(accounts: NetWorthAccountLike[]): NetWorthTotals {
  const totalAssets = sumMoney(accounts.filter((a) => a.type !== "credit").map((a) => a.balance));
  const totalLiabilities = sumMoney(accounts.filter((a) => a.type === "credit").map((a) => a.balance));
  return {
    totalAssets,
    totalLiabilities,
    netWorth: subtractMoney(totalAssets, totalLiabilities),
  };
}
