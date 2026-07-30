/**
 * One member's ceremony facts for the recap week (per-member points, stage 5).
 *
 * OPTIONAL on the document: every recap generated before the ceremony shipped
 * carries none of this, and the client's deck degrades to the pre-deck layout
 * when it is absent. Points are DERIVED from habit attribution over the closed
 * week — never read from `HouseholdMember.points.weekly`, which the client's
 * midnight scheduler has already rolled over by the time Monday's generation
 * runs.
 */
export interface RecapMemberFacts {
  memberId: string;
  /** Display name at generation time (the doc is a snapshot, not a join). */
  name: string;
  /** Signed points this member earned during the recap week. */
  points: number;
  /** Attributed habit completions (units) this member logged during the week. */
  completions: number;
  /** The member's highest-scoring day of the week, or null when they scored none. */
  bestDay: { date: string; points: number } | null;
  /** The member's longest live streak at week end, in the habit's own cadence. */
  topStreak: { habitTitle: string; days: number; period: "daily" | "weekly" } | null;
  /** Titles of DAILY habits this member completed on all 7 days of the week. */
  perfectHabits: string[];
}

/**
 * One day of the ceremony's 7-day stacked chart (Monday-first).
 *
 * `total = Σ byMember + unattributed`, by construction. `unattributed` is the
 * grandfathering series: completions recorded before the attribution layer
 * shipped belong to no member but still happened, so they stay visible as a
 * neutral segment rather than vanishing from the household's own week.
 */
export interface RecapDayPoints {
  /** yyyy-MM-dd, local to the generating timezone. */
  date: string;
  /** memberId → signed points that member earned that day. */
  byMember: Record<string, number>;
  /** Signed points that day that no member holds attribution for. */
  unattributed: number;
  /** Signed household points for the day. */
  total: number;
}

/**
 * The weekly recap document shape, written to
 * `households/{householdId}/recaps/{isoWeek}` by the `sendweeklyrecap`
 * scheduled function.
 *
 * Money fields (`totalSpend`, `priorWeekSpend`, `topCategoryDeltas[].current`/
 * `.prior`, `upcomingBills[].amount`) are DECIMAL DOLLARS, per house convention
 * (see CLAUDE.md: sums are done in integer cents internally but the values
 * stored/returned are decimal dollars, matching `Transaction.amount` /
 * `Account.balance`).
 */
export interface WeeklyRecap {
  /** ISO week identifier, e.g. "2026-W27" (also the document id). */
  isoWeek: string;
  /** ISO 8601 timestamp of when this recap was generated. */
  generatedAt: string;

  /** Total verified, non-income spend for the recap week (decimal dollars). */
  totalSpend: number;
  /** Total verified, non-income spend for the prior week (decimal dollars). */
  priorWeekSpend: number;
  /** Up to 3 categories with the largest week-over-week spend swing. */
  topCategoryDeltas: Array<{ category: string; current: number; prior: number }>;

  /** Count of habit completions logged during the recap week. */
  habitCompletions: number;
  /** Habits with a streak of 3+ that did NOT complete on the week's last day. */
  streaksAtRisk: Array<{ habitTitle: string; streakDays: number }>;

  /** Points earned per household member during the recap week. */
  pointsByMember: Array<{ memberId: string; name: string; points: number }>;

  /** Expense calendar items due in the 7 days following the recap week. */
  upcomingBills: Array<{ title: string; amount: number; date: string }>;

  /** 2-sentence warm summary, either AI-generated or a deterministic template. */
  narrative: string;
  narrativeSource: "ai" | "template";

  /** Whether this household saw the premium experience (AI narrative + push). */
  premium: boolean;

  // --- Ceremony fields (per-member points, stage 5) -----------------------
  // All optional: absent on every recap written before the ceremony shipped,
  // and the client renders its pre-deck layout when they are missing.

  /** Per-member ceremony facts, one entry per household member. */
  memberFacts?: RecapMemberFacts[];
  /** Exactly 7 entries, Monday → Sunday of the recap week. */
  dailyPoints?: RecapDayPoints[];
  /** Signed household points for the recap week (`Σ dailyPoints[].total`). */
  totalPoints?: number;
  /** Signed household points for the week BEFORE the recap week (trend base). */
  priorWeekPoints?: number;
  /** The household's ceremony tone at generation time (drives the deck order). */
  ceremonyTone?: "podium" | "household_first" | "adaptive";
}
