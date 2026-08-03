import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RecapNumericFields } from "./narrative";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Import AFTER mocks are registered.
import {
  buildPrompt,
  buildTemplateNarrative,
  deriveVerdicts,
  generateNarrative,
  pointsTrendPct,
  resolveCeremonyTone,
  selectNarrativeFraming,
} from "./narrative";

/**
 * A pre-split document: no `billsSpend`/`dayToDaySpend`, no ceremony fields.
 * Every W27–W30 recap looks like this, so it doubles as the "old document must
 * still work" fixture.
 */
const SAMPLE: RecapNumericFields = {
  totalSpend: 120.5,
  priorWeekSpend: 80,
  topCategoryDeltas: [{ category: "Groceries", current: 100, prior: 60 }],
  habitCompletions: 5,
  streaksAtRisk: [{ habitTitle: "Exercise", streakDays: 4 }],
  pointsByMember: [{ memberId: "u1", name: "Alex", points: 30 }],
  upcomingBills: [{ title: "Rent", amount: 1500, date: "2026-07-06" }],
};

const EMPTY_SAMPLE: RecapNumericFields = {
  totalSpend: 0,
  priorWeekSpend: 0,
  topCategoryDeltas: [],
  habitCompletions: 0,
  streaksAtRisk: [],
  pointsByMember: [],
  upcomingBills: [],
};

/**
 * 🛡️ THE REAL 2026-W31 FIGURES (RECAP-MATH / NARR-1).
 *
 * The recap this household actually received for this week opened with "The
 * household showed fantastic momentum this week" and claimed spending "rose to
 * $2,649.89 compared to $803.12 last week" — a >3x increase, on a week whose
 * DAY-TO-DAY spending rose about 1.4x and whose total was inflated by a heavy
 * bill week (and by the `Credit Card` routing sentinel, since removed).
 *
 * `priorWeekPoints` is deliberately ABSENT: the real figure for W30 is not
 * known, and inventing one would let the fixture pass for the wrong reason.
 * That also exercises the "unknown trend, do not claim one" path.
 */
const W31: RecapNumericFields = {
  totalSpend: 2429.0,
  priorWeekSpend: 803.12,
  billsSpend: 1306.77,
  priorWeekBillsSpend: 0,
  dayToDaySpend: 1122.23,
  priorWeekDayToDaySpend: 803.12,
  topCategoryDeltas: [],
  habitCompletions: 47,
  streaksAtRisk: [],
  pointsByMember: [{ memberId: "u1", name: "Jen", points: 28 }],
  totalPoints: 28,
  memberFacts: [
    {
      memberId: "u1",
      name: "Jen",
      points: 28,
      completions: 47,
      bestDay: null,
      topStreak: { habitTitle: "Shower", days: 5, period: "daily" },
      perfectHabits: [],
    },
  ],
  // Due on the MONDAY the recap is read — the original narrative pitched it as
  // next week's planning ("due on August 3rd" in a recap read on August 3rd).
  upcomingBills: [{ title: "AT&T Wireless", amount: 216.8, date: "2026-08-03" }],
  weekEnd: "2026-08-02",
  unattributedSplit: { householdCredit: 18, unclaimed: 0 },
};

/** Day-to-day spending up hard AND points down hard — a week that went backwards. */
const BAD_WEEK: RecapNumericFields = {
  totalSpend: 940,
  priorWeekSpend: 500,
  billsSpend: 200,
  priorWeekBillsSpend: 200,
  dayToDaySpend: 740,
  priorWeekDayToDaySpend: 300,
  topCategoryDeltas: [{ category: "Dining out", current: 380, prior: 90 }],
  habitCompletions: 9,
  streaksAtRisk: [{ habitTitle: "Exercise", streakDays: 6 }],
  pointsByMember: [{ memberId: "u1", name: "Jen", points: 120 }],
  totalPoints: 120,
  priorWeekPoints: 260,
  upcomingBills: [],
  weekEnd: "2026-08-02",
};

/** Day-to-day spending down hard AND points up — a week that earned its praise. */
const GOOD_WEEK: RecapNumericFields = {
  totalSpend: 420,
  priorWeekSpend: 900,
  billsSpend: 100,
  priorWeekBillsSpend: 100,
  dayToDaySpend: 320,
  priorWeekDayToDaySpend: 800,
  topCategoryDeltas: [],
  habitCompletions: 22,
  streaksAtRisk: [],
  pointsByMember: [{ memberId: "u1", name: "Jen", points: 300 }],
  totalPoints: 300,
  priorWeekPoints: 200,
  upcomingBills: [],
  weekEnd: "2026-08-02",
};

/** Nothing moved materially in either direction. */
const FLAT_WEEK: RecapNumericFields = {
  totalSpend: 310,
  priorWeekSpend: 300,
  billsSpend: 0,
  priorWeekBillsSpend: 0,
  dayToDaySpend: 310,
  priorWeekDayToDaySpend: 300,
  topCategoryDeltas: [],
  habitCompletions: 8,
  streaksAtRisk: [],
  pointsByMember: [{ memberId: "u1", name: "Jen", points: 205 }],
  totalPoints: 205,
  priorWeekPoints: 200,
  upcomingBills: [],
  weekEnd: "2026-08-02",
};

/** Total spend tripled, but ONLY because rent landed — day-to-day was flat. */
const BILL_HEAVY_WEEK: RecapNumericFields = {
  totalSpend: 2400,
  priorWeekSpend: 800,
  billsSpend: 1600,
  priorWeekBillsSpend: 0,
  dayToDaySpend: 800,
  priorWeekDayToDaySpend: 800,
  topCategoryDeltas: [],
  habitCompletions: 12,
  streaksAtRisk: [],
  pointsByMember: [{ memberId: "u1", name: "Jen", points: 200 }],
  totalPoints: 200,
  priorWeekPoints: 200,
  upcomingBills: [],
  weekEnd: "2026-08-02",
};

// ---------------------------------------------------------------------------
// Verdicts — the deterministic judgements both narrative paths consume
// ---------------------------------------------------------------------------

describe("deriveVerdicts", () => {
  it("compares DAY-TO-DAY spending when the split is present, not the total", () => {
    const { spend } = deriveVerdicts(W31);
    expect(spend.basis).toBe("dayToDay");
    expect(spend.current).toBe(1122.23);
    expect(spend.prior).toBe(803.12);
    expect(spend.direction).toBe("up");
    expect(spend.material).toBe(true);
    // ~1.4x, NOT the ~3x the total-vs-total comparison produced.
    expect(spend.ratio).toBeCloseTo(1.4, 1);
  });

  it("falls back to the total on a document written before the split", () => {
    const { spend } = deriveVerdicts(SAMPLE);
    expect(spend.basis).toBe("total");
    expect(spend.current).toBe(120.5);
    expect(spend.prior).toBe(80);
  });

  it("calls a rent week a HEAVY BILL week rather than a spending change", () => {
    const verdicts = deriveVerdicts(BILL_HEAVY_WEEK);
    expect(verdicts.bills.heavy).toBe(true);
    expect(verdicts.spend.direction).toBe("flat");
    expect(verdicts.spend.material).toBe(false);
    expect(verdicts.week).not.toBe("worse");
  });

  it("marks bills UNKNOWN rather than zero on a pre-split document", () => {
    expect(deriveVerdicts(SAMPLE).bills.known).toBe(false);
  });

  it("gates spend materiality on BOTH a ratio and an absolute floor", () => {
    // +50% but only $40.50 — under the absolute floor.
    expect(deriveVerdicts(SAMPLE).spend.material).toBe(false);
    // Large absolute move but a tiny proportional one.
    const bigFlat = deriveVerdicts({
      ...FLAT_WEEK,
      dayToDaySpend: 10_060,
      priorWeekDayToDaySpend: 10_000,
      totalSpend: 10_060,
      priorWeekSpend: 10_000,
    });
    expect(bigFlat.spend.material).toBe(false);
  });

  it("reads the points trend, and refuses to claim one without a prior week", () => {
    expect(deriveVerdicts(BAD_WEEK).points).toMatchObject({ direction: "down", material: true, pct: -54 });
    expect(deriveVerdicts(GOOD_WEEK).points).toMatchObject({ direction: "up", material: true, pct: 50 });
    expect(deriveVerdicts(FLAT_WEEK).points).toMatchObject({ direction: "up", material: false });
    expect(deriveVerdicts(W31).points).toMatchObject({ direction: "unknown", material: false, prior: null });
  });

  it("scores the week from the comparables that actually moved", () => {
    expect(deriveVerdicts(BAD_WEEK).week).toBe("worse");
    expect(deriveVerdicts(GOOD_WEEK).week).toBe("better");
    expect(deriveVerdicts(FLAT_WEEK).week).toBe("flat");
    expect(deriveVerdicts(EMPTY_SAMPLE).week).toBe("quiet");
    // Spending up AND points up — opposite votes, so neither story wins.
    expect(deriveVerdicts({ ...BAD_WEEK, totalPoints: 400, priorWeekPoints: 200 }).week).toBe("mixed");
  });

  it("only calls a category a spike when it cleared both gates", () => {
    expect(deriveVerdicts(BAD_WEEK).categorySpike).toMatchObject({ category: "Dining out", delta: 290 });
    // $40.50 swing on Groceries — under the dollar floor.
    expect(deriveVerdicts(SAMPLE).categorySpike).toBeNull();
  });

  it("ranks a real standout fact above a trivial one, and flags the trivial one", () => {
    const trivial = deriveVerdicts(W31).highlight;
    expect(trivial).toMatchObject({ kind: "short_streak", notable: false });
    expect(trivial?.text).toContain("5-day streak with Shower");

    const withPerfect = deriveVerdicts({
      ...W31,
      memberFacts: [
        {
          memberId: "u1",
          name: "Jen",
          points: 28,
          completions: 47,
          bestDay: null,
          topStreak: { habitTitle: "Shower", days: 5, period: "daily" },
          perfectHabits: ["Read 30 mins"],
        },
      ],
    }).highlight;
    expect(withPerfect).toMatchObject({ kind: "perfect_week", notable: true });
  });

  it("puts the spend anomaly ahead of a streak, and the bill last", () => {
    expect(deriveVerdicts(BAD_WEEK).action?.kind).toBe("category");
    expect(deriveVerdicts(SAMPLE).action?.kind).toBe("streak");
    expect(deriveVerdicts(W31).action?.kind).toBe("bill");
    expect(deriveVerdicts(GOOD_WEEK).action).toBeNull();
  });

  it("dates an upcoming bill against the day the recap is READ", () => {
    // weekEnd is the Sunday; the recap is opened on the following Monday.
    expect(deriveVerdicts(W31).action?.text).toBe("AT&T Wireless, $216.80, is due today.");
    expect(
      deriveVerdicts({ ...W31, upcomingBills: [{ title: "AT&T Wireless", amount: 216.8, date: "2026-08-04" }] })
        .action?.text
    ).toBe("AT&T Wireless, $216.80, is due tomorrow.");
    expect(
      deriveVerdicts({ ...W31, upcomingBills: [{ title: "AT&T Wireless", amount: 216.8, date: "2026-08-07" }] })
        .action?.text
    ).toBe("AT&T Wireless, $216.80, is due August 7.");
    // Without weekEnd (any caller that can't supply it) it degrades to a date.
    const { weekEnd: _weekEnd, ...noWeekEnd } = W31;
    expect(deriveVerdicts(noWeekEnd).action?.text).toBe("AT&T Wireless, $216.80, is due August 3.");
  });
});

// ---------------------------------------------------------------------------
// Template narrative — the copy that actually ships on any AI failure
// ---------------------------------------------------------------------------

describe("buildTemplateNarrative", () => {
  it("is deterministic for the same input", () => {
    expect(buildTemplateNarrative(SAMPLE)).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("never congratulates, exclaims, or hypes", () => {
    for (const fixture of [SAMPLE, EMPTY_SAMPLE, W31, BAD_WEEK, GOOD_WEEK, FLAT_WEEK, BILL_HEAVY_WEEK]) {
      const text = buildTemplateNarrative(fixture);
      expect(text).not.toContain("!");
      expect(text.toLowerCase()).not.toMatch(/momentum|fantastic|amazing|keep it up|great work|doing great/);
    }
  });

  it("states the numbers on a pre-split week without characterising a sub-threshold move", () => {
    const text = buildTemplateNarrative(SAMPLE);
    expect(text).toBe(
      "Spending was $120.50 this week against $80.00 last week. " +
        "You logged 5 habit completions this week. " +
        "Exercise carries a 4-day streak that missed the week's last day."
    );
  });

  it("handles a fully empty week gracefully", () => {
    const text = buildTemplateNarrative(EMPTY_SAMPLE);
    expect(text).toContain("No verified spending was logged this week.");
    expect(text).toContain("No habit activity was logged this week");
  });

  it("says plainly that a week went backwards", () => {
    const text = buildTemplateNarrative(BAD_WEEK);
    expect(text).toBe(
      "This week came out behind last week. " +
        "Day-to-day spending rose to $740.00, up from $300.00 last week. " +
        "Bills accounted for $200.00 of the week's $940.00 total. " +
        "9 habit completions earned 120 points, down 54% on last week's 260. " +
        "Dining out is where the increase came from — $380.00 against $90.00 last week."
    );
  });

  it("is allowed to be positive about a week that genuinely improved", () => {
    const text = buildTemplateNarrative(GOOD_WEEK);
    expect(text).toContain("This week came out ahead of last week.");
    expect(text).toContain("Day-to-day spending fell to $320.00, down from $800.00 last week.");
    expect(text).toContain("up 50% on last week's 200");
  });

  it("does not invent a win on a flat week", () => {
    const text = buildTemplateNarrative(FLAT_WEEK);
    expect(text).not.toContain("came out ahead");
    expect(text).not.toContain("came out behind");
    expect(text).toBe(
      "Day-to-day spending was $310.00 this week against $300.00 last week. " +
        "8 habit completions earned 205 points, about level with last week's 200."
    );
  });

  it("does not describe a heavy bill week as overspending", () => {
    const text = buildTemplateNarrative(BILL_HEAVY_WEEK);
    expect(text).toContain("Day-to-day spending was $800.00 this week against $800.00 last week.");
    expect(text).toContain("Bills took another $1,600.00");
    expect(text).not.toContain("rose to");
    expect(text).not.toContain("came out behind");
  });

  it("produces valid prose with no undefined/NaN when every optional field is absent", () => {
    for (const fixture of [SAMPLE, EMPTY_SAMPLE]) {
      const text = buildTemplateNarrative(fixture);
      expect(text).not.toMatch(/undefined|NaN|Infinity/);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it("survives a document carrying garbage figures without emitting NaN", () => {
    const text = buildTemplateNarrative({
      ...SAMPLE,
      totalSpend: Number.NaN,
      priorWeekSpend: Number.NaN,
    });
    expect(text).not.toMatch(/undefined|NaN|Infinity/);
  });
});

// ---------------------------------------------------------------------------
// 🛡️ The regression this work exists for
// ---------------------------------------------------------------------------

describe("2026-W31 regression — 'spending tripled' and 'fantastic momentum'", () => {
  it("compares day-to-day spending (~1.4x), never the bill-inflated total (~3x)", () => {
    const text = buildTemplateNarrative(W31);
    expect(text).toContain("Day-to-day spending rose to $1,122.23, up from $803.12 last week.");
    // The figure the old narrative built its one concrete comparison from.
    expect(text).not.toContain("$2,649.89");
    // The total appears only as context for the bill week, never as "you spent".
    expect(text).not.toContain("You spent $2,429.00");
  });

  it("names bills as the reason the total looks large", () => {
    expect(buildTemplateNarrative(W31)).toContain(
      "Bills took another $1,306.77 — most of the week's $2,429.00 total"
    );
  });

  it("does not lead with, or even cite, the 5-day shower streak", () => {
    expect(buildTemplateNarrative(W31)).not.toContain("Shower");
  });

  it("dates the AT&T bill as due TODAY, not as next week's planning", () => {
    const text = buildTemplateNarrative(W31);
    expect(text).toContain("AT&T Wireless, $216.80, is due today.");
    expect(text).not.toContain("August 3");
  });

  it("produces the full honest narrative", () => {
    expect(buildTemplateNarrative(W31)).toBe(
      "This week came out behind last week. " +
        "Day-to-day spending rose to $1,122.23, up from $803.12 last week. " +
        "Bills took another $1,306.77 — most of the week's $2,429.00 total, and already budgeted. " +
        "47 habit completions earned 28 points. " +
        "AT&T Wireless, $216.80, is due today."
    );
  });
});

describe("generateNarrative", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns source 'ai' on a successful Gemini call", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "Spending held level. Points were down." });

    const result = await generateNarrative(SAMPLE, "fake-key");

    expect(result).toEqual({ text: "Spending held level. Points were down.", source: "ai" });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("sends the DERIVED verdicts to the model, not just raw figures", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "ok" });

    await generateNarrative(BAD_WEEK, "fake-key");

    const contents = generateContentMock.mock.calls[0]?.[0]?.contents as string;
    expect(contents).toContain("Week verdict: worse");
    expect(contents).toContain("do not second-guess or recompute them");
  });

  it("falls back to the template when Gemini throws", async () => {
    generateContentMock.mockRejectedValueOnce(new Error("upstream failure"));

    const result = await generateNarrative(SAMPLE, "fake-key");

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("falls back to the template when Gemini returns a malformed/empty response", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "" });

    const result = await generateNarrative(SAMPLE, "fake-key");

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("falls back to the template when Gemini hangs past the timeout", async () => {
    generateContentMock.mockImplementationOnce(
      () => new Promise(() => {
        // Never resolves — simulates a hang.
      })
    );

    // Inject a short timeout so the test doesn't wait the real 30 seconds.
    const result = await generateNarrative(SAMPLE, "fake-key", "household_first", 50);

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("falls back to an HONEST template on a bad week, not a cheerful one", async () => {
    generateContentMock.mockRejectedValueOnce(new Error("upstream failure"));

    const result = await generateNarrative(BAD_WEEK, "fake-key");

    expect(result.source).toBe("template");
    expect(result.text).toContain("This week came out behind last week.");
    expect(result.text).not.toContain("!");
  });
});

// ---------------------------------------------------------------------------
// Tone-aware framing (per-member points, stage 5)
// ---------------------------------------------------------------------------

/** A two-adult contest with the given leader / runner-up point totals. */
function contest(leaderPoints: number, runnerUpPoints: number): RecapNumericFields {
  return {
    ...SAMPLE,
    pointsByMember: [
      { memberId: "u1", name: "Jen", points: leaderPoints },
      { memberId: "u2", name: "Paul", points: runnerUpPoints },
    ],
    totalPoints: leaderPoints + runnerUpPoints,
    priorWeekPoints: 700,
  };
}

describe("resolveCeremonyTone", () => {
  it("maps absent and unrecognised values onto household_first", () => {
    expect(resolveCeremonyTone(undefined)).toBe("household_first");
    expect(resolveCeremonyTone("")).toBe("household_first");
    expect(resolveCeremonyTone("nonsense")).toBe("household_first");
  });

  it("passes through each recognised tone", () => {
    expect(resolveCeremonyTone("podium")).toBe("podium");
    expect(resolveCeremonyTone("adaptive")).toBe("adaptive");
    expect(resolveCeremonyTone("household_first")).toBe("household_first");
  });
});

describe("selectNarrativeFraming", () => {
  it("household_first stays together even on a blowout", () => {
    const framing = selectNarrativeFraming(contest(900, 100), "household_first");
    expect(framing.framing).toBe("together");
    expect(framing.runaway).toBe(true);
  });

  it("podium leads head-to-head even on a close week", () => {
    const framing = selectNarrativeFraming(contest(410, 385), "podium");
    expect(framing.framing).toBe("podium");
    expect(framing.leader?.name).toBe("Jen");
    expect(framing.runnerUp?.name).toBe("Paul");
    expect(framing.margin).toBe(25);
    expect(framing.runaway).toBe(false);
  });

  it("adaptive keeps a close week together and crowns a runaway one", () => {
    expect(selectNarrativeFraming(contest(410, 385), "adaptive").framing).toBe("together");
    expect(selectNarrativeFraming(contest(600, 200), "adaptive").framing).toBe("podium");
  });

  it("never frames a podium without a strict leader (a tie, or a lone scorer)", () => {
    expect(selectNarrativeFraming(contest(400, 400), "podium").framing).toBe("together");
    expect(selectNarrativeFraming(contest(400, 0), "podium").framing).toBe("together");
  });

  it("prefers derived memberFacts over pointsByMember when both are present", () => {
    const recap: RecapNumericFields = {
      ...contest(10, 5),
      memberFacts: [
        {
          memberId: "u2",
          name: "Paul",
          points: 500,
          completions: 20,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
        {
          memberId: "u1",
          name: "Jen",
          points: 100,
          completions: 4,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
      ],
    };
    const framing = selectNarrativeFraming(recap, "podium");
    expect(framing.leader?.name).toBe("Paul");
    expect(framing.margin).toBe(400);
  });

  it("NEVER crowns a managed kid, however chore-heavy their week was", () => {
    // Leo's points come from chores credited to his own member doc — an
    // allowance ledger, not a competitive score. Adults only, matching
    // `selectAdultStandings` / `getAdultStandings` on the client.
    const recap: RecapNumericFields = {
      ...contest(0, 0),
      memberFacts: [
        {
          memberId: "kid_leo",
          name: "Leo",
          points: 900,
          completions: 30,
          isManaged: true,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
        {
          memberId: "u1",
          name: "Jen",
          points: 120,
          completions: 6,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
        {
          memberId: "u2",
          name: "Paul",
          points: 40,
          completions: 3,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
      ],
    };
    const framing = selectNarrativeFraming(recap, "podium");
    expect(framing.leader?.name).toBe("Jen");
    expect(framing.runnerUp?.name).toBe("Paul");
    expect(framing.margin).toBe(80);
    expect(buildTemplateNarrative(recap, "podium")).not.toContain("Leo");
    expect(buildPrompt(recap, "podium")).not.toContain("Leo");
  });
});

describe("buildTemplateNarrative — tone", () => {
  it("frames the head-to-head under podium and the household under household_first", () => {
    const recap = contest(410, 385);
    expect(buildTemplateNarrative(recap, "podium")).toContain(
      "Jen edged out the week with 410 points to Paul's 385"
    );
    expect(buildTemplateNarrative(recap, "household_first")).toContain("5 habit completions");
    expect(buildTemplateNarrative(recap, "household_first")).not.toContain("edged out the week");
  });

  it("says 'ran away with' only for a runaway margin", () => {
    expect(buildTemplateNarrative(contest(600, 200), "podium")).toContain("ran away with the week");
    expect(buildTemplateNarrative(contest(410, 385), "podium")).toContain("edged out the week");
  });

  it("adaptive crowns only a runaway week", () => {
    expect(buildTemplateNarrative(contest(600, 200), "adaptive")).toContain("ran away with the week");
    expect(buildTemplateNarrative(contest(410, 385), "adaptive")).not.toContain("the week with");
  });

  it("defaults to household_first when no tone is passed (pre-stage-5 behaviour)", () => {
    expect(buildTemplateNarrative(contest(600, 200))).toBe(
      buildTemplateNarrative(contest(600, 200), "household_first")
    );
  });

  it("keeps the money sentence identical across every tone — money is not a contest", () => {
    const recap = contest(600, 200);
    const spendSentence = "Spending was $120.50 this week against $80.00 last week.";
    for (const tone of ["podium", "household_first", "adaptive"] as const) {
      expect(buildTemplateNarrative(recap, tone)).toContain(spendSentence);
    }
  });
});

describe("pointsTrendPct", () => {
  it("returns null without a usable prior week", () => {
    expect(pointsTrendPct(SAMPLE)).toBeNull();
    expect(pointsTrendPct({ ...SAMPLE, totalPoints: 100, priorWeekPoints: 0 })).toBeNull();
  });

  it("rounds the percent change against the prior week", () => {
    expect(pointsTrendPct({ ...SAMPLE, totalPoints: 795, priorWeekPoints: 710 })).toBe(12);
    expect(pointsTrendPct({ ...SAMPLE, totalPoints: 500, priorWeekPoints: 1000 })).toBe(-50);
  });
});

describe("buildPrompt", () => {
  it("instructs the model to lead with the head-to-head under a podium framing", () => {
    const prompt = buildPrompt(contest(600, 200), "podium");
    expect(prompt).toContain("Lead with the head-to-head");
    expect(prompt).toContain("Jen finished ahead of Paul by 400 points");
  });

  it("instructs the model to lead with the household otherwise, and never to crown", () => {
    const prompt = buildPrompt(contest(600, 200), "household_first");
    expect(prompt).toContain("do not crown a winner");
    expect(prompt).not.toContain("Lead with the head-to-head");
  });

  it("carries every verdict, phrased as settled fact", () => {
    const prompt = buildPrompt(BAD_WEEK);
    expect(prompt).toContain("Week verdict: worse");
    expect(prompt).toContain("Comparison basis: day-to-day spending");
    expect(prompt).toContain("Day-to-day spending: rose, materially — $740.00 this week against $300.00 last week");
    expect(prompt).toContain("Habit points: down (54%)");
    expect(prompt).toContain("Biggest category change: Dining out");
    expect(prompt).toContain("Worth attention: Dining out is where the increase came from");
  });

  it("forbids the cheerleader voice outright", () => {
    const prompt = buildPrompt(W31);
    expect(prompt).toContain("You are a scorekeeper, not a cheerleader.");
    expect(prompt).toContain("No exclamation marks.");
    expect(prompt).toContain("Do NOT congratulate by default");
    expect(prompt).toContain("Do not compute, re-derive, combine, or re-round them.");
  });

  it("tells the model a heavy bill week is NOT overspending", () => {
    const prompt = buildPrompt(BILL_HEAVY_WEEK);
    expect(prompt).toContain("a HEAVY BILL WEEK");
    expect(prompt).toContain("this is NOT overspending and must not be described as such");
  });

  it("marks a trivial standout fact so the model won't lead with it", () => {
    expect(buildPrompt(W31)).toContain("streak with Shower (minor)");
    expect(buildPrompt(W31)).toContain('Do not lead with a fact marked "(minor)"');
  });

  it("🛡️ never lets household-credit points be called missing or unattributed", () => {
    const prompt = buildPrompt(W31);
    expect(prompt).toContain(
      "Household-credit points: 18 of this week's points come from shared habits the household earns TOGETHER by design."
    );
    expect(prompt).toContain("Never describe them as missing, unattributed, unclaimed, or a problem.");
  });

  it("omits the household-credit line entirely when the split is absent or zero", () => {
    expect(buildPrompt(SAMPLE)).not.toContain("Household-credit points");
    expect(buildPrompt({ ...W31, unattributedSplit: { householdCredit: 0, unclaimed: 4 } })).not.toContain(
      "Household-credit points"
    );
  });

  it("refuses to invent advice when there is nothing worth attention", () => {
    expect(buildPrompt(GOOD_WEEK)).toContain("Worth attention: nothing — do not invent a suggestion");
  });

  it("says bills are UNKNOWN, not zero, on a pre-split document", () => {
    const prompt = buildPrompt(SAMPLE);
    expect(prompt).toContain("Bills: not separable on this week's data");
    expect(prompt).not.toMatch(/undefined|NaN/);
  });

  it("never emits undefined or NaN for any fixture", () => {
    for (const fixture of [SAMPLE, EMPTY_SAMPLE, W31, BAD_WEEK, GOOD_WEEK, FLAT_WEEK, BILL_HEAVY_WEEK]) {
      for (const tone of ["podium", "household_first", "adaptive"] as const) {
        expect(buildPrompt(fixture, tone)).not.toMatch(/undefined|NaN|Infinity/);
      }
    }
  });
});
