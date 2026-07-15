import { describe, it, expect } from "vitest";
import { fuzzyMatchMember, type MemberLike } from "./todoMatch";

const MEMBERS: MemberLike[] = [
  { uid: "u1", displayName: "Sam" },
  { uid: "u2", displayName: "Samantha" },
  { uid: "u3", displayName: "Jordan" },
];

describe("fuzzyMatchMember", () => {
  it("returns null for an empty/blank search term", () => {
    expect(fuzzyMatchMember(MEMBERS, "")).toBeNull();
    expect(fuzzyMatchMember(MEMBERS, "   ")).toBeNull();
  });

  it("matches on an exact (case/whitespace-insensitive) display name", () => {
    expect(fuzzyMatchMember(MEMBERS, "jordan")).toEqual(MEMBERS[2]);
    expect(fuzzyMatchMember(MEMBERS, "  Jordan  ")).toEqual(MEMBERS[2]);
    expect(fuzzyMatchMember(MEMBERS, "JORDAN")).toEqual(MEMBERS[2]);
  });

  it("exact match wins even when it would also be a contains-match substring", () => {
    // "Sam" is an exact match for member u1 AND a contains-match for "Samantha" —
    // exact match must win, not be treated as ambiguous.
    expect(fuzzyMatchMember(MEMBERS, "Sam")).toEqual(MEMBERS[0]);
  });

  it("falls back to a unique contains match", () => {
    expect(fuzzyMatchMember(MEMBERS, "antha")).toEqual(MEMBERS[1]);
  });

  it("falls back to a unique starts-with match", () => {
    const members: MemberLike[] = [
      { uid: "u1", displayName: "Jordan Smith" },
      { uid: "u2", displayName: "Alex" },
    ];
    expect(fuzzyMatchMember(members, "Jord")).toEqual(members[0]);
  });

  it("returns null when no member matches at all", () => {
    expect(fuzzyMatchMember(MEMBERS, "Zzyzx")).toBeNull();
  });

  it("returns null (never guesses) when a tier has multiple equally-good candidates", () => {
    const members: MemberLike[] = [
      { uid: "u1", displayName: "Sam Jones" },
      { uid: "u2", displayName: "Sam Lee" },
    ];
    // Neither exact, so falls to contains — two contain "sam" — ambiguous.
    expect(fuzzyMatchMember(members, "Sam")).toBeNull();
  });

  it("returns null against an empty member list", () => {
    expect(fuzzyMatchMember([], "Sam")).toBeNull();
  });
});
