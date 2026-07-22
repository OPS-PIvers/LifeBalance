import { describe, it, expect } from "vitest";
import { parseShoppingPhrase } from "./shoppingParser";

// Matches the app's GROCERY_CATEGORIES (data/groceryCategories.ts) minus
// "Uncategorized" (that's the parser's own fallback, not a caller-supplied
// option) plus "Bakery" deliberately OMITTED from most tests so the
// not-in-caller's-list fallback path gets exercised.
const CATEGORIES = ["Produce", "Dairy", "Meat", "Pantry", "Snacks", "Beverages", "Frozen", "Household"];
const CATEGORIES_WITH_BAKERY = [...CATEGORIES, "Bakery"];

describe("parseShoppingPhrase", () => {
  it("returns no items for empty input", () => {
    expect(parseShoppingPhrase("", CATEGORIES)).toEqual({ items: [] });
    expect(parseShoppingPhrase("   ", CATEGORIES)).toEqual({ items: [] });
  });

  it("returns no items when the phrase is only stop words", () => {
    expect(parseShoppingPhrase("add to the list", CATEGORIES)).toEqual({ items: [] });
  });

  describe("segmentation", () => {
    it("splits multiple items on commas", () => {
      expect(parseShoppingPhrase("milk, eggs, bread", CATEGORIES).items.map((i) => i.item)).toEqual([
        "milk",
        "eggs",
        "bread",
      ]);
    });

    it("splits on newlines", () => {
      expect(parseShoppingPhrase("milk\neggs\nbread", CATEGORIES).items.map((i) => i.item)).toEqual([
        "milk",
        "eggs",
        "bread",
      ]);
    });

    it("splits on '&'", () => {
      expect(parseShoppingPhrase("milk & eggs", CATEGORIES).items.map((i) => i.item)).toEqual(["milk", "eggs"]);
    });

    it("splits on ' and ' — documented over-split for 'salt and pepper'", () => {
      // "salt and pepper" is a single logical grocery item, but the
      // segmenter unconditionally splits on " and " (needed for the far more
      // common "milk and eggs and bread" case), so this over-splits into two
      // rows. This is accepted/documented behavior — the review drawer lets
      // the user merge them back if desired.
      const result = parseShoppingPhrase("salt and pepper", CATEGORIES);
      expect(result.items.map((i) => i.item)).toEqual(["salt", "pepper"]);
      expect(result.items.every((i) => i.category === "Pantry")).toBe(true);
    });

    it("splits a mixed multi-item utterance", () => {
      const result = parseShoppingPhrase("2 milk, a dozen eggs and bread", CATEGORIES);
      expect(result.items).toEqual([
        { item: "milk", quantity: 2, category: "Dairy" },
        { item: "eggs", quantity: 12, category: "Dairy" },
        { item: "bread", quantity: 1, category: "Uncategorized" },
      ]);
    });
  });

  describe("lead-verb / list-phrase stripping", () => {
    it("strips common imperative verbs", () => {
      expect(parseShoppingPhrase("buy milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("get milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("grab milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("pick up milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("need milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("add milk", CATEGORIES).items[0]?.item).toBe("milk");
    });

    it("strips 'please' and combined 'need to buy' phrasing", () => {
      expect(parseShoppingPhrase("please add milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("we need to buy milk", CATEGORIES).items[0]?.item).toBe("milk");
    });

    it("strips a leading 'add to list' phrase", () => {
      expect(parseShoppingPhrase("add to list milk", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("add to the shopping list milk", CATEGORIES).items[0]?.item).toBe("milk");
    });

    it("strips a trailing 'to the (shopping/grocery) list' phrase", () => {
      expect(parseShoppingPhrase("milk to the list", CATEGORIES).items[0]?.item).toBe("milk");
      expect(parseShoppingPhrase("eggs to the shopping list", CATEGORIES).items[0]?.item).toBe("eggs");
      expect(parseShoppingPhrase("bread to the grocery list", CATEGORIES).items[0]?.item).toBe("bread");
    });
  });

  describe("quantity forms", () => {
    it("leading integer", () => {
      expect(parseShoppingPhrase("2 milk", CATEGORIES).items[0]).toEqual({
        item: "milk",
        quantity: 2,
        category: "Dairy",
      });
    });

    it("never returns quantity 0", () => {
      expect(parseShoppingPhrase("0 milk", CATEGORIES).items[0]?.quantity).toBe(1);
    });

    it("'a'/'an' = 1", () => {
      expect(parseShoppingPhrase("a lemon", CATEGORIES).items[0]).toMatchObject({ item: "lemon", quantity: 1 });
      expect(parseShoppingPhrase("an onion", CATEGORIES).items[0]).toMatchObject({ item: "onion", quantity: 1 });
    });

    it("'a couple (of)' = 2", () => {
      expect(parseShoppingPhrase("a couple apples", CATEGORIES).items[0]).toMatchObject({
        item: "apples",
        quantity: 2,
      });
      expect(parseShoppingPhrase("a couple of apples", CATEGORIES).items[0]).toMatchObject({
        item: "apples",
        quantity: 2,
      });
    });

    it("'a dozen' = 12, 'half a dozen' = 6", () => {
      expect(parseShoppingPhrase("a dozen eggs", CATEGORIES).items[0]).toMatchObject({
        item: "eggs",
        quantity: 12,
      });
      expect(parseShoppingPhrase("dozen eggs", CATEGORIES).items[0]).toMatchObject({
        item: "eggs",
        quantity: 12,
      });
      expect(parseShoppingPhrase("half a dozen eggs", CATEGORIES).items[0]).toMatchObject({
        item: "eggs",
        quantity: 6,
      });
    });

    it("number words two..twelve", () => {
      expect(parseShoppingPhrase("two apples", CATEGORIES).items[0]).toMatchObject({ item: "apples", quantity: 2 });
      expect(parseShoppingPhrase("twelve eggs", CATEGORIES).items[0]).toMatchObject({
        item: "eggs",
        quantity: 12,
      });
    });

    it("unit phrases: '<N> <unit> of <item>'", () => {
      expect(parseShoppingPhrase("2 lbs of chicken", CATEGORIES).items[0]).toEqual({
        item: "chicken",
        quantity: 2,
        category: "Meat",
      });
    });

    it("unit phrases: 'a <unit> of <item>' = quantity 1", () => {
      expect(parseShoppingPhrase("a bag of chips", CATEGORIES).items[0]).toEqual({
        item: "chips",
        quantity: 1,
        category: "Snacks",
      });
    });

    it("defaults to quantity 1 with no quantity phrase", () => {
      expect(parseShoppingPhrase("bread", CATEGORIES).items[0]?.quantity).toBe(1);
    });
  });

  describe("category mapping", () => {
    it("maps common groceries to their category when present in the caller's list", () => {
      expect(parseShoppingPhrase("milk", CATEGORIES).items[0]?.category).toBe("Dairy");
      expect(parseShoppingPhrase("cheese", CATEGORIES).items[0]?.category).toBe("Dairy");
      expect(parseShoppingPhrase("eggs", CATEGORIES).items[0]?.category).toBe("Dairy");
      expect(parseShoppingPhrase("apple", CATEGORIES).items[0]?.category).toBe("Produce");
      expect(parseShoppingPhrase("banana", CATEGORIES).items[0]?.category).toBe("Produce");
      expect(parseShoppingPhrase("lettuce", CATEGORIES).items[0]?.category).toBe("Produce");
      expect(parseShoppingPhrase("chicken", CATEGORIES).items[0]?.category).toBe("Meat");
      expect(parseShoppingPhrase("frozen pizza", CATEGORIES).items[0]?.category).toBe("Frozen");
      expect(parseShoppingPhrase("toilet paper", CATEGORIES).items[0]?.category).toBe("Household");
    });

    it("maps bread to Bakery only when the caller's category list includes it", () => {
      expect(parseShoppingPhrase("bread", CATEGORIES_WITH_BAKERY).items[0]?.category).toBe("Bakery");
    });

    it("falls back to Uncategorized when the mapped category isn't in the caller's list", () => {
      // "Bakery" is a real mapping the parser knows about, but CATEGORIES
      // (deliberately) omits it, so the result must fall back rather than
      // return a category the caller didn't offer.
      expect(parseShoppingPhrase("bread", CATEGORIES).items[0]?.category).toBe("Uncategorized");
    });

    it("falls back to Uncategorized for unrecognized items", () => {
      expect(parseShoppingPhrase("flux capacitor", CATEGORIES_WITH_BAKERY).items[0]?.category).toBe(
        "Uncategorized"
      );
    });
  });
});
