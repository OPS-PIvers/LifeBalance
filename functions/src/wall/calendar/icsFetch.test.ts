import { describe, expect, it, vi } from "vitest";
import { FeedFetchError, fetchIcs, normalizeFeedUrl, type FetchLike } from "./icsFetch";

const ICS = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";

describe("normalizeFeedUrl", () => {
  it("rewrites webcal links to https", () => {
    expect(normalizeFeedUrl(" webcal://p01-caldav.icloud.com/published/2/abc ")).toBe(
      "https://p01-caldav.icloud.com/published/2/abc"
    );
  });
  it("rejects internal and non-http addresses", () => {
    for (const bad of ["http://localhost/x.ics", "http://169.254.169.254/x", "ftp://a.com/x", "metadata/x", "", 42]) {
      expect(() => normalizeFeedUrl(bad)).toThrow(/public calendar link/);
    }
  });
});

describe("fetchIcs", () => {
  it("returns the body and validators", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(ICS, { headers: { etag: '"v1"', "last-modified": "Mon" } }));
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, fetchImpl)).resolves.toEqual({
      status: "ok",
      text: ICS,
      etag: '"v1"',
      lastModified: "Mon",
    });
  });

  it("sends conditional headers and passes a 304 through", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 304 }));
    await expect(fetchIcs("https://cal.example.com/a.ics", { etag: '"v1"', lastModified: "Mon" }, fetchImpl)).resolves.toEqual({
      status: "not-modified",
    });
    const headers = fetchImpl.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('"v1"');
    expect(headers["If-Modified-Since"]).toBe("Mon");
  });

  it("follows public redirects but checks every hop", async () => {
    const ok = vi.fn<FetchLike>(async (url) =>
      url.endsWith("/a.ics")
        ? new Response(null, { status: 302, headers: { location: "/b.ics" } })
        : new Response(ICS)
    );
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, ok)).resolves.toMatchObject({ status: "ok" });
    expect(ok.mock.calls.map((c) => c[0])).toEqual(["https://cal.example.com/a.ics", "https://cal.example.com/b.ics"]);

    const internal = vi.fn<FetchLike>(async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/x" } }));
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, internal)).rejects.toThrow(/redirects somewhere/);
    expect(internal).toHaveBeenCalledTimes(1);
  });

  it("explains dead links and oversize bodies", async () => {
    const gone: FetchLike = async () => new Response("no", { status: 404 });
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, gone)).rejects.toThrow(/no longer works/);
    const huge: FetchLike = async () => new Response("x", { headers: { "content-length": String(6 * 1024 * 1024) } });
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, huge)).rejects.toThrow(FeedFetchError);
    const streamed: FetchLike = async () => new Response("x".repeat(5 * 1024 * 1024 + 1));
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, streamed)).rejects.toThrow(/too big/);
  });

  it("wraps network failures", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchIcs("https://cal.example.com/a.ics", {}, down)).rejects.toThrow(/Couldn't reach/);
  });
});
