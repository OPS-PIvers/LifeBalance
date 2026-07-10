/**
 * Tests for the `fetchrecipepage` helpers (Plan 19): the SSRF URL validator and
 * the JSON-LD / HTML-fallback text extraction. Mirrors geminiProxy.test.ts's
 * mocking style — `onCall` returns the raw handler; `HttpsError` records its
 * `code` so rejections can be asserted on.
 */

import { describe, it, expect, vi } from "vitest";

const { MockHttpsError } = vi.hoisted(() => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "HttpsError";
    }
  }
  return { MockHttpsError };
});

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { assertFetchableUrl, extractRecipeText } from "./fetchRecipePage";

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof MockHttpsError) return error.code;
    throw error;
  }
  return undefined;
};

describe("assertFetchableUrl (SSRF guard)", () => {
  it("accepts a normal https URL", () => {
    const url = assertFetchableUrl("https://www.allrecipes.com/recipe/12345/");
    expect(url.hostname).toBe("www.allrecipes.com");
  });

  it("accepts a normal http URL", () => {
    expect(assertFetchableUrl("http://example.com/soup").protocol).toBe("http:");
  });

  it("rejects non-http protocols (file:)", () => {
    expect(codeOf(() => assertFetchableUrl("file:///etc/passwd"))).toBe(
      "invalid-argument"
    );
  });

  it("rejects IPv4 literals, including non-dotted forms URL normalizes", () => {
    expect(codeOf(() => assertFetchableUrl("http://169.254.169.254/meta"))).toBe(
      "invalid-argument"
    );
    // WHATWG URL normalizes a decimal host to dotted-quad (127.0.0.1).
    expect(codeOf(() => assertFetchableUrl("http://2130706433/"))).toBe(
      "invalid-argument"
    );
  });

  it("rejects IPv6 literals", () => {
    expect(codeOf(() => assertFetchableUrl("http://[::1]/admin"))).toBe(
      "invalid-argument"
    );
  });

  it("rejects localhost and internal hostnames", () => {
    for (const bad of [
      "http://localhost:3000/",
      "https://foo.localhost/",
      "https://printer.local/",
      "https://db.internal/status",
    ]) {
      expect(codeOf(() => assertFetchableUrl(bad)), bad).toBe("invalid-argument");
    }
  });

  it("rejects missing / non-string / unparseable input", () => {
    expect(codeOf(() => assertFetchableUrl(undefined))).toBe("invalid-argument");
    expect(codeOf(() => assertFetchableUrl(42))).toBe("invalid-argument");
    expect(codeOf(() => assertFetchableUrl("not a url"))).toBe("invalid-argument");
  });
});

describe("extractRecipeText", () => {
  const RECIPE_JSON = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Weeknight Chili",
    description: "A fast pantry chili.",
    recipeIngredient: ["1 lb ground beef", "1 can kidney beans"],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Brown the beef." },
      { "@type": "HowToStep", text: "Add beans and simmer." },
    ],
  };

  it("prefers a JSON-LD Recipe block and renders compact text", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(
      RECIPE_JSON
    )}</script></head><body><nav>Ads ads ads</nav></body></html>`;

    const result = extractRecipeText(html);
    expect(result.usedJsonLd).toBe(true);
    expect(result.text).toContain("Weeknight Chili");
    expect(result.text).toContain("A fast pantry chili.");
    expect(result.text).toContain("- 1 lb ground beef");
    expect(result.text).toContain("1. Brown the beef.");
    expect(result.text).toContain("2. Add beans and simmer.");
    expect(result.text).not.toContain("Ads ads ads");
  });

  it("finds a Recipe nested inside @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebPage", name: "Page" }, RECIPE_JSON],
    })}</script>`;

    const result = extractRecipeText(html);
    expect(result.usedJsonLd).toBe(true);
    expect(result.text).toContain("Weeknight Chili");
  });

  it("handles @type arrays and string instructions", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": ["Recipe", "NewsArticle"],
      name: "Toast",
      recipeIngredient: ["1 slice bread"],
      recipeInstructions: "Toast the bread.",
    })}</script>`;

    const result = extractRecipeText(html);
    expect(result.usedJsonLd).toBe(true);
    expect(result.text).toContain("Toast the bread.");
  });

  it("falls back to stripped page text when there is no JSON-LD", () => {
    const html = `<html><head><style>body{color:red}</style><script>var x=1;</script></head>
      <body><h1>Grandma&#39;s Soup</h1><p>Boil   water.&nbsp;Add salt.</p></body></html>`;

    const result = extractRecipeText(html);
    expect(result.usedJsonLd).toBe(false);
    expect(result.text).toBe("Grandma's Soup Boil water. Add salt.");
    expect(result.text).not.toContain("var x=1");
    expect(result.text).not.toContain("color:red");
  });

  it("falls back when the only JSON-LD block is malformed", () => {
    const html = `<script type="application/ld+json">{not valid json</script>
      <body>Plain recipe text here</body>`;

    const result = extractRecipeText(html);
    expect(result.usedJsonLd).toBe(false);
    expect(result.text).toContain("Plain recipe text here");
  });

  it("caps output at parseRecipe's 10,000-char limit", () => {
    const html = `<body>${"word ".repeat(5000)}</body>`;
    expect(extractRecipeText(html).text.length).toBeLessThanOrEqual(10_000);
  });
});
