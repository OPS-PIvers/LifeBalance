/**
 * F-MONEY-14 — heuristics about how a merchant string READS, as opposed to what
 * it matches. Kept out of `utils/merchantRules.ts` on purpose: that module is
 * the matching engine and gets duplicated into `functions/src/quickAdd/` for the
 * server side, where "does this look ugly to a human" has no meaning.
 */

/**
 * Whether a merchant string reads like raw bank text rather than something a
 * person typed. Gates the inline rename affordance so a hand-entered "Coffee"
 * isn't offered a rename it doesn't need, while the descriptors this feature
 * exists for do qualify:
 *
 *   "AMERICAN EXPRESS ACH PMT"        → all-caps          ✓
 *   "APPLE.COM/BILL 866-712-7753 CA"  → all-caps + digits ✓
 *   "Target" / "Trader Joe's"         → neither           ✗
 *
 * The all-caps test is the load-bearing one: it is what catches
 * `AMEX ACH PAYMENT`, which carries no trailing noise at all. Gating instead on
 * "did `suggestPatternFromDescriptor` strip something" would have missed exactly
 * the descriptor that motivated the feature.
 *
 * A lowercase-but-ugly descriptor falls through to the Settings editor. That is
 * an accepted miss rather than an oversight — the cost of a false NEGATIVE is
 * one extra trip to Settings, while a false POSITIVE nags on every hand-entered
 * row forever.
 */
export function looksLikeBankDescriptor(merchant: string): boolean {
  const trimmed = merchant.trim();
  if (trimmed.length < 2) return false;

  // Unicode-aware so an accented all-caps descriptor ("CAFÉ MÜLLER") still reads
  // as caps rather than being judged on its ASCII letters alone.
  const letters = trimmed.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase()) return true;

  if (/\d/.test(trimmed)) return true;

  // Payment-processor markers: "SQ *COFFEE", "PAYPAL *STORE", "AMZN Mktp#123".
  return /[*/#]/.test(trimmed);
}
