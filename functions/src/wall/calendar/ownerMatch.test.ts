import { describe, expect, it } from "vitest";
import { eventOwners, memberNames, namesKey } from "./ownerMatch";

const names = memberNames([
  { uid: "paul", displayName: "Paul Ivers" },
  { uid: "mia", displayName: "Mia" },
  { uid: "leo", displayName: "Leo" },
  { uid: "will", displayName: "Will" },
]);

describe("memberNames", () => {
  it("takes each member's first name in roster order", () => {
    expect(names.map((n) => n.first)).toEqual(["Paul", "Mia", "Leo", "Will"]);
  });

  it("drops a first name two members share, and blank or one-letter names", () => {
    const got = memberNames([
      { uid: "a", displayName: "Sam Lee" },
      { uid: "b", displayName: "sam Ortiz" },
      { uid: "c", displayName: "J" },
      { uid: "d", displayName: "" },
      { uid: "e" },
      { uid: "f", displayName: "Ana" },
    ]);
    expect(got).toEqual([{ uid: "f", first: "Ana" }]);
  });
});

describe("eventOwners", () => {
  it.each([
    ["Leo soccer", "", ["leo"]],
    ["leo – soccer", "", ["leo"]],
    ["Soccer (LEO)", "", ["leo"]],
    ["Leo's game", "", ["leo"]],
    ["Mia’s dentist", "", ["mia"]],
    ["Pick up Leo + Mia", "", ["mia", "leo"]],
    ["Leon's birthday party", "", []],
    ["Paulina sleepover", "", []],
    ["Farmers market", "", []],
  ])("title %j → %j", (title, description, expected) => {
    expect(eventOwners(title, description, names)).toEqual(expected);
  });

  it("reads the description only when the title names no one", () => {
    expect(eventOwners("Dentist", "Appointment for Mia.\nBring insurance card.", names)).toEqual(["mia"]);
    expect(eventOwners("Leo practice", "Mia is driving", names)).toEqual(["leo"]);
  });

  it("needs a capitalised name in the description, where names are also words", () => {
    expect(eventOwners("Practice", "We will be late", names)).toEqual([]);
    expect(eventOwners("Practice", "Will has cleats in the car", names)).toEqual(["will"]);
  });

  it("names no one with no names to match", () => {
    expect(eventOwners("Leo soccer", "", [])).toEqual([]);
  });
});

describe("namesKey", () => {
  it("changes when a member is renamed", () => {
    const renamed = memberNames([{ uid: "mia", displayName: "Amelia" }]);
    expect(namesKey(renamed)).not.toBe(namesKey(memberNames([{ uid: "mia", displayName: "Mia" }])));
  });
});
