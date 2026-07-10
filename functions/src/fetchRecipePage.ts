/**
 * Callable Cloud Function: fetch a recipe web page server-side and reduce it to
 * plain text the client's existing AI recipe parser (`parseRecipe` in
 * services/geminiService.ts) can consume (Plan 19).
 *
 * Why server-side: browsers can't fetch arbitrary recipe sites (CORS), and the
 * Gemini model cannot browse. This function does ONLY the page fetch + text
 * extraction — the structured parse (response schema + validator + quota) stays
 * in the client's parseRecipe path, unchanged.
 *
 * SSRF guards (mandatory — this is a server-side fetch proxy): only http/https
 * URLs whose hostname is a public-looking DNS name are fetched. IP literals
 * (v4/v6), localhost, *.localhost, *.local and *.internal are rejected before
 * any network call (trailing FQDN dots stripped first), and the FINAL URL
 * after redirects is re-validated against the same guard before the body is
 * read. Residual limitation: a public DNS name that RESOLVES to an internal
 * address (DNS rebinding) is not detected — mitigated by the content-type
 * allowlist, the body-size cap, and the fact that no credentials are sent.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

/** Result shape returned to the client. */
export interface FetchRecipePageResult {
  text: string;
  usedJsonLd: boolean;
}

/** Matches parseRecipe's input cap (services/geminiService.ts). */
const MAX_TEXT_CHARS = 10_000;

/** Hard cap on how many response bytes we read (~1.5 MB). */
const MAX_BODY_BYTES = 1_500_000;

/** Fetch timeout (ms). */
const FETCH_TIMEOUT_MS = 10_000;

/** Dotted-quad IPv4 literal (WHATWG URL normalizes hex/decimal hosts to this form). */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validate a caller-supplied URL for server-side fetching. Returns the parsed
 * URL or throws `invalid-argument` on anything that is not a plain public
 * http(s) address.
 *
 * Exported for unit tests.
 */
export function assertFetchableUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HttpsError(
      "invalid-argument",
      "The function must be called with a non-empty 'url' string."
    );
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpsError("invalid-argument", "That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpsError(
      "invalid-argument",
      "Only http(s) links can be imported."
    );
  }

  // WHATWG URL lowercases hostnames and normalizes IPv4 forms (hex, decimal,
  // partial) to dotted-quad, so these string checks see canonical values.
  // IPv6 literals keep their brackets in `hostname` ("[::1]"). One canonical
  // form it does NOT normalize: a trailing dot on a DNS name ("localhost."
  // resolves identically to "localhost" but keeps its dot) — strip it so the
  // internal-name checks can't be bypassed with an FQDN dot.
  const hostname = url.hostname.replace(/\.$/, "");
  const isIpLiteral =
    IPV4_RE.test(hostname) || hostname.startsWith("[") || hostname.includes(":");
  const isInternalName =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    // Single-label hostnames (no dot) are internal service names in cloud /
    // container environments ("metadata", "vault", "router") — a public
    // recipe site always has a TLD, so rejecting dotless names costs nothing.
    !hostname.includes(".");
  if (isIpLiteral || isInternalName) {
    throw new HttpsError(
      "invalid-argument",
      "That address can't be imported. Use a public recipe link."
    );
  }

  return url;
}

/** schema.org JSON-LD node — arbitrary shape; we probe it defensively. */
type JsonLdNode = Record<string, unknown>;

/** Whether a JSON-LD node's @type is or includes "Recipe". */
function isRecipeNode(node: unknown): node is JsonLdNode {
  if (typeof node !== "object" || node === null) return false;
  const type = (node as JsonLdNode)["@type"];
  if (typeof type === "string") return type === "Recipe";
  if (Array.isArray(type)) return type.includes("Recipe");
  return false;
}

/**
 * Depth-first search for a Recipe node in a parsed JSON-LD document: the root
 * itself, arrays of nodes, and nodes nested under `@graph`.
 */
function findRecipeNode(root: unknown, depth = 0): JsonLdNode | undefined {
  if (depth > 4) return undefined;
  if (isRecipeNode(root)) return root;
  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findRecipeNode(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof root === "object" && root !== null) {
    const graph = (root as JsonLdNode)["@graph"];
    if (graph !== undefined) return findRecipeNode(graph, depth + 1);
  }
  return undefined;
}

/**
 * Flatten schema.org `recipeInstructions` — which can be a plain string, an
 * array of strings, `HowToStep` objects ({ text }), or `HowToSection`s whose
 * `itemListElement` nests more steps — into a flat list of step strings.
 */
function flattenInstructions(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenInstructions(entry, depth + 1));
  }
  if (typeof value === "object") {
    const node = value as JsonLdNode;
    if (typeof node.text === "string" && node.text.trim()) {
      return [node.text.trim()];
    }
    // HowToSection: recurse into its steps, prefixed by the section name.
    const nested = flattenInstructions(node.itemListElement, depth + 1);
    if (nested.length > 0 && typeof node.name === "string" && node.name.trim()) {
      return [`${node.name.trim()}:`, ...nested];
    }
    return nested;
  }
  return [];
}

/** Render a JSON-LD Recipe node as compact plain text for the AI parser. */
function renderRecipeNode(recipe: JsonLdNode): string {
  const lines: string[] = [];
  if (typeof recipe.name === "string" && recipe.name.trim()) {
    lines.push(recipe.name.trim());
  }
  if (typeof recipe.description === "string" && recipe.description.trim()) {
    lines.push(recipe.description.trim());
  }
  const ingredients = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient.filter(
        (i): i is string => typeof i === "string" && i.trim().length > 0
      )
    : [];
  if (ingredients.length > 0) {
    lines.push("", "Ingredients:", ...ingredients.map((i) => `- ${i.trim()}`));
  }
  const steps = flattenInstructions(recipe.recipeInstructions);
  if (steps.length > 0) {
    lines.push("", "Instructions:", ...steps.map((s, i) => `${i + 1}. ${s}`));
  }
  return lines.join("\n").trim();
}

/**
 * Every `<script type="application/ld+json">` block in the page, in document
 * order. Attribute order/quoting varies across sites, so match loosely.
 */
function jsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
}

/** Dumb HTML-to-text fallback: strip script/style, tags, collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Decimal and hex numeric character references (smart quotes, dashes,
    // fraction glyphs — common on recipe sites). Non-printable results are
    // dropped rather than emitted.
    .replace(/&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi, (_, hex, dec) => {
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduce a fetched HTML page to recipe text: prefer a schema.org JSON-LD
 * Recipe block (clean, ad-free), fall back to stripped page text. Truncated to
 * parseRecipe's 10,000-char input cap either way.
 *
 * Exported for unit tests.
 */
export function extractRecipeText(html: string): FetchRecipePageResult {
  for (const block of jsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue; // Malformed JSON-LD: try the next block / fall back.
    }
    const recipe = findRecipeNode(parsed);
    if (recipe) {
      const text = renderRecipeNode(recipe);
      if (text) {
        return { text: text.slice(0, MAX_TEXT_CHARS), usedJsonLd: true };
      }
    }
  }
  return { text: htmlToText(html).slice(0, MAX_TEXT_CHARS), usedJsonLd: false };
}

/** Read at most `maxBytes` from a fetch Response body as UTF-8 text. */
async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      const keep = value.byteLength - (received - maxBytes);
      text += decoder.decode(value.subarray(0, keep), { stream: true });
      await reader.cancel().catch(() => undefined);
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export const fetchrecipepage = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
  },
  async (request): Promise<FetchRecipePageResult> => {
    // Only authenticated app users may use the fetch proxy.
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const url = assertFetchableUrl((request.data ?? {}).url);

    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "LifeBalanceRecipeBot/1.0" },
      });
    } catch (error) {
      clearTimeout(timer);
      logger.warn("fetchrecipepage: fetch failed", { url: url.href, error });
      throw new HttpsError(
        "unavailable",
        "Couldn't reach that site. Check the link or paste the recipe text instead."
      );
    }

    // Redirects are followed, so re-validate the FINAL url the fetch landed on
    // — otherwise a public page that 302s to an internal host would bypass the
    // pre-fetch SSRF checks. (response.url is empty for some mocked responses;
    // an empty value means no redirect information, so nothing to re-check.)
    try {
      if (response.url) assertFetchableUrl(response.url);
    } catch (error) {
      clearTimeout(timer);
      await response.body?.cancel().catch(() => undefined);
      logger.warn("fetchrecipepage: redirect target rejected", {
        url: url.href,
        finalUrl: response.url,
      });
      throw error;
    }

    // The abort timer stays armed through the body read (not just the fetch),
    // so a server that trickles bytes can't hold the invocation open past the
    // deadline — the aborted stream makes readBodyCapped reject.
    try {
      if (!response.ok) {
        throw new HttpsError(
          "not-found",
          `That page couldn't be loaded (HTTP ${response.status}).`
        );
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const isAllowedType =
        contentType.startsWith("text/html") ||
        contentType.startsWith("text/plain") ||
        contentType.startsWith("application/ld+json");
      if (!isAllowedType) {
        throw new HttpsError(
          "failed-precondition",
          "That link isn't a web page. Use a link to a recipe page."
        );
      }

      let body: string;
      try {
        body = await readBodyCapped(response, MAX_BODY_BYTES);
      } catch (error) {
        logger.warn("fetchrecipepage: body read failed", { url: url.href, error });
        throw new HttpsError(
          "unavailable",
          "Couldn't read that page in time. Try again or paste the recipe text instead."
        );
      }
      const result = extractRecipeText(body);
      if (!result.text) {
        throw new HttpsError(
          "not-found",
          "No readable recipe content was found on that page."
        );
      }

      logger.info("fetchrecipepage: extracted", {
        url: url.href,
        usedJsonLd: result.usedJsonLd,
        chars: result.text.length,
      });
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
);
