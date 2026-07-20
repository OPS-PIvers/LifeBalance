import { describe, it, expect } from "vitest";
import { parseTodoPhrase } from "./todoParser";

// 2026-07-20 is a Monday.
const TODAY = "2026-07-20";

describe("parseTodoPhrase", () => {
  it("parses the canonical Siri phrase", () => {
    expect(
      parseTodoPhrase("Call dentist tomorrow at 3pm, remind me 30 minutes before", TODAY)
    ).toEqual({
      text: "Call dentist",
      dueDate: "2026-07-21",
      dueTime: "15:00",
      reminderMinutesBefore: 30,
    });
  });

  describe("dates", () => {
    it("today / tonight / tomorrow", () => {
      expect(parseTodoPhrase("water plants today", TODAY).dueDate).toBe(TODAY);
      expect(parseTodoPhrase("take out trash tonight", TODAY).dueDate).toBe(TODAY);
      expect(parseTodoPhrase("mow lawn tomorrow", TODAY).dueDate).toBe("2026-07-21");
    });

    it("weekday names: bare = next occurrence, 'next' = the week after", () => {
      // Today is Monday 2026-07-20.
      expect(parseTodoPhrase("dentist on friday", TODAY).dueDate).toBe("2026-07-24");
      expect(parseTodoPhrase("dentist friday", TODAY).dueDate).toBe("2026-07-24");
      expect(parseTodoPhrase("dentist next friday", TODAY).dueDate).toBe("2026-07-31");
      // A bare weekday equal to today's weekday means next week.
      expect(parseTodoPhrase("dentist monday", TODAY).dueDate).toBe("2026-07-27");
    });

    it("relative spans", () => {
      expect(parseTodoPhrase("renew passport in 3 days", TODAY).dueDate).toBe("2026-07-23");
      expect(parseTodoPhrase("renew passport in a week", TODAY).dueDate).toBe("2026-07-27");
      expect(parseTodoPhrase("renew passport next week", TODAY).dueDate).toBe("2026-07-27");
    });

    it("month-name dates with year rollover", () => {
      expect(parseTodoPhrase("file taxes july 25", TODAY).dueDate).toBe("2026-07-25");
      expect(parseTodoPhrase("file taxes on July 25th", TODAY).dueDate).toBe("2026-07-25");
      expect(parseTodoPhrase("file taxes on the 25th of july", TODAY).dueDate).toBe("2026-07-25");
      // Already past this year -> next year.
      expect(parseTodoPhrase("plan party january 5", TODAY).dueDate).toBe("2027-01-05");
    });

    it("numeric dates require an 'on/by/due' cue so fractions are safe", () => {
      expect(parseTodoPhrase("submit form by 8/1", TODAY).dueDate).toBe("2026-08-01");
      expect(parseTodoPhrase("submit form on 8/1/2027", TODAY).dueDate).toBe("2027-08-01");
      expect(parseTodoPhrase("mix 1/2 cup of flour", TODAY).dueDate).toBeUndefined();
      expect(parseTodoPhrase("mix 1/2 cup of flour", TODAY).text).toBe("mix 1/2 cup of flour");
    });
  });

  describe("times", () => {
    it("am/pm forms with and without minutes and 'at'", () => {
      expect(parseTodoPhrase("gym at 6am", TODAY).dueTime).toBe("06:00");
      expect(parseTodoPhrase("gym at 6:15 pm", TODAY).dueTime).toBe("18:15");
      expect(parseTodoPhrase("gym 7pm", TODAY).dueTime).toBe("19:00");
      expect(parseTodoPhrase("standup at 12pm", TODAY).dueTime).toBe("12:00");
      expect(parseTodoPhrase("wake at 12am", TODAY).dueTime).toBe("00:00");
    });

    it("24-hour and bare-hour forms require 'at'", () => {
      expect(parseTodoPhrase("meeting at 15:00", TODAY).dueTime).toBe("15:00");
      expect(parseTodoPhrase("meeting at 9", TODAY).dueTime).toBe("09:00");
      expect(parseTodoPhrase("buy 3 lemons", TODAY).dueTime).toBeUndefined();
    });

    it("noon and midnight", () => {
      expect(parseTodoPhrase("lunch at noon", TODAY).dueTime).toBe("12:00");
      expect(parseTodoPhrase("backup at midnight", TODAY).dueTime).toBe("00:00");
    });

    it("a parsed time with no date anchors to today", () => {
      const parsed = parseTodoPhrase("call mom at 5pm", TODAY);
      expect(parsed.dueDate).toBe(TODAY);
      expect(parsed.dueTime).toBe("17:00");
    });
  });

  describe("reminders", () => {
    it("numeric minutes and hours", () => {
      expect(parseTodoPhrase("dentist at 3pm remind me 30 minutes before", TODAY).reminderMinutesBefore).toBe(30);
      expect(parseTodoPhrase("dentist at 3pm remind me 2 hours before", TODAY).reminderMinutesBefore).toBe(120);
      expect(parseTodoPhrase("dentist at 3pm remind me 45 min before", TODAY).reminderMinutesBefore).toBe(45);
    });

    it("word forms", () => {
      expect(parseTodoPhrase("dentist at 3pm remind me an hour before", TODAY).reminderMinutesBefore).toBe(60);
      expect(parseTodoPhrase("dentist at 3pm remind me the day before", TODAY).reminderMinutesBefore).toBe(1440);
    });

    it("bare 'remind me' means at the due time", () => {
      expect(parseTodoPhrase("dentist at 3pm remind me", TODAY).reminderMinutesBefore).toBe(0);
      expect(parseTodoPhrase("dentist at 3pm with a reminder", TODAY).reminderMinutesBefore).toBe(0);
    });

    it("a reminder with no time anchor is dropped", () => {
      const parsed = parseTodoPhrase("dentist tomorrow remind me 30 minutes before", TODAY);
      expect(parsed.reminderMinutesBefore).toBeUndefined();
      expect(parsed.dueDate).toBe("2026-07-21");
    });
  });

  describe("importance", () => {
    it("the word 'important' and trailing bangs", () => {
      expect(parseTodoPhrase("important: renew insurance tomorrow", TODAY).isImportant).toBe(true);
      expect(parseTodoPhrase("renew insurance tomorrow, this is important", TODAY).isImportant).toBe(true);
      expect(parseTodoPhrase("renew insurance tomorrow!!", TODAY).isImportant).toBe(true);
      expect(parseTodoPhrase("renew insurance tomorrow", TODAY).isImportant).toBeUndefined();
    });
  });

  describe("text cleanup", () => {
    it("removes parsed fragments and dangling connectives", () => {
      expect(parseTodoPhrase("Call dentist tomorrow at 3pm", TODAY).text).toBe("Call dentist");
      expect(parseTodoPhrase("pick up kids on friday at 3:15pm", TODAY).text).toBe("pick up kids");
    });

    it("never returns an empty text", () => {
      const parsed = parseTodoPhrase("tomorrow at 3pm", TODAY);
      expect(parsed.text).toBe("tomorrow at 3pm");
      expect(parsed.dueDate).toBe("2026-07-21");
    });

    it("leaves unrecognized text fully intact", () => {
      const parsed = parseTodoPhrase("descale the espresso machine", TODAY);
      expect(parsed).toEqual({ text: "descale the espresso machine" });
    });
  });
});
