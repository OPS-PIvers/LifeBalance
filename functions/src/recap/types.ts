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
  /**
   * Signed points this member earned during the recap week — their OWN score,
   * including any chores assigned to them. That makes it deliberately WIDER
   * than their share of the household figure: chore points credit the assignee
   * alone and never the household pool, so `Σ memberFacts[].points` is not
   * `totalPoints` in a household with assigned chores.
   */
  points: number;
  /** Attributed habit completions (units) this member logged during the week. */
  completions: number;
  /**
   * True for a login-less managed kid profile. Absent means adult.
   *
   * Standings, podium and head-to-head are ADULTS ONLY (matching
   * `selectAdultStandings` / `getAdultStandings` on the client) — a managed
   * kid's chore points are their own, not a competitive score, and must never
   * crown them the week's winner. The kid still gets their own personal card.
   */
  isManaged?: boolean;
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
 * `total = Σ byMember + unattributed`, by construction, and that total IS the
 * household figure — so `byMember` holds each member's SHARED-habit share only
 * (chores assigned to a member credit them alone, never the household pool).
 * `unattributed` is the grandfathering series: completions recorded before the
 * attribution layer shipped belong to no member but still happened, so they
 * stay visible as a neutral segment rather than vanishing from the household's
 * own week.
 */
/**
 * WHY a chunk of points belongs to no individual member — the decomposition of
 * `RecapDayPoints.unattributed` (RECAP-MATH).
 *
 * Mirrors `RecapUnattributedSplit` in the client's `types/schema.ts` (separate
 * pnpm package, so the shape is duplicated rather than imported).
 *
 * 🛡️ `householdCredit + unclaimed === unattributed`, BY CONSTRUCTION: both
 * halves come from the same `unattributedPointsOnDate` walk that produces
 * `unattributed` itself, partitioned per habit — never a subtraction.
 *
 *  1. DELIBERATE household credit (`Habit.creditMode === 'household'`): the
 *     household earned these together on purpose, and such a completion writes
 *     NO `completedBy` entry by design.
 *  2. Everything else with no holder: pre-attribution (grandfathered) history,
 *     or a real gap (a per-member habit fired by something that never recorded
 *     a person).
 *
 * There is deliberately no THIRD bucket splitting those two apart: `creditMode`
 * is absent on every pre-feature habit and reads as `'members'`, so the shapes
 * are identical on the document and cannot be told apart after the fact.
 */
export interface RecapUnattributedSplit {
  /** Signed points from `creditMode: 'household'` habits — together, by design. */
  householdCredit: number;
  /** Signed points nobody holds for any other reason (legacy history or a gap). */
  unclaimed: number;
}

export interface RecapDayPoints {
  /** yyyy-MM-dd, local to the generating timezone. */
  date: string;
  /** memberId → signed points that member earned that day. */
  byMember: Record<string, number>;
  /** Signed points that day that no member holds attribution for. */
  unattributed: number;
  /** Signed household points for the day. */
  total: number;
  /**
   * Why that day's `unattributed` belongs to nobody (RECAP-MATH). OPTIONAL:
   * absent on every recap written before the split shipped, so read it as
   * "unknown", never as "zero household credit".
   */
  unattributedSplit?: RecapUnattributedSplit;
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

  /**
   * ALL counted spend for the recap week (decimal dollars) — bills included.
   *
   * "Counted" excludes income AND the `Credit Card` account-routing sentinel,
   * which is not real spending (RECAP-MATH; mirrors the client's
   * `utils/bucketSpentCalculator.ts`). Recaps written before that fix counted
   * the sentinel, so an old document's figure is not comparable to a new one's.
   */
  totalSpend: number;
  /** The same figure for the prior week (decimal dollars). */
  priorWeekSpend: number;
  /**
   * Up to 3 categories with the largest week-over-week spend swing.
   *
   * Excludes the `Budgeted in Calendar` calendar-bill sentinel (RECAP-MATH):
   * it is a routing tag, not a category, and a heavy bill week made it win this
   * list every time.
   */
  topCategoryDeltas: Array<{ category: string; current: number; prior: number }>;

  /** Count of habit completions logged during the recap week. */
  habitCompletions: number;
  /** Habits with a streak of 3+ that did NOT complete on the week's last day. */
  streaksAtRisk: Array<{ habitTitle: string; streakDays: number }>;

  /**
   * Points earned per household member during the recap week, DERIVED from
   * habit completions (attribution + assigned chores) — never read from
   * `HouseholdMember.points.weekly`, which Monday-morning generation would find
   * already rolled over. Empty when the week carries no per-member data at all.
   */
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

  // --- Spend decomposition (RECAP-MATH) -----------------------------------
  // ALL OPTIONAL: absent on every recap written before the split shipped.
  //
  // 🛡️ `billsSpend + dayToDaySpend === totalSpend`, by construction — each is
  // its own filter over the same counted-spend predicate, never a subtraction.
  // The split exists because lumping them together made the week-over-week
  // headline meaningless: a heavy bill week reads as a 3x "spending increase"
  // when day-to-day spending was actually flat.

  /**
   * Counted spend the calendar already budgeted (decimal dollars) — the
   * `Budgeted in Calendar` sentinel paid bills are filed under, plus the legacy
   * `Bills` tag. Real outflows, just not discretionary ones.
   */
  billsSpend?: number;
  /** The same figure for the week BEFORE the recap week. */
  priorWeekBillsSpend?: number;
  /** Counted spend that is NOT a paid calendar bill (decimal dollars). */
  dayToDaySpend?: number;
  /** The same figure for the week BEFORE the recap week. */
  priorWeekDayToDaySpend?: number;

  /**
   * Week totals of `dailyPoints[].unattributedSplit` — how much of the week's
   * unattributed pool was DELIBERATE household credit versus genuinely
   * unclaimed (RECAP-MATH). `householdCredit + unclaimed === Σ
   * dailyPoints[].unattributed`.
   */
  unattributedSplit?: RecapUnattributedSplit;
}
