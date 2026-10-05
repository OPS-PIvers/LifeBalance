/**
 * Pure rules for the wall's spoken replies (`walltts`): what text may be
 * spoken, the Google Cloud Text-to-Speech request, and the per-household
 * daily cap. See docs/plans/wall-display-kiosk.md §12 "Sound".
 */

/** Longest single phrase. A brief is spoken line by line, so no line comes close. */
export const TTS_MAX_CHARS = 400;
/** Phrases per household per UTC day. A busy family uses well under 100. */
export const TTS_DAILY_CAP = 500;
/** A natural-sounding Google voice (Chirp 3 HD). Plain text only: no SSML. */
export const TTS_VOICE = "en-US-Chirp3-HD-Aoede";
export const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** Collapses whitespace; null when there's nothing to say or it's too long. */
export function ttsText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > TTS_MAX_CHARS) return null;
  return text;
}

export function ttsRequestBody(text: string): Record<string, unknown> {
  return {
    input: { text },
    voice: { languageCode: "en-US", name: TTS_VOICE },
    audioConfig: { audioEncoding: "MP3" },
  };
}

export interface TtsUsage {
  date: string;
  count: number;
}

/** The next usage counter, or null when today's cap is spent. */
export function nextTtsUsage(stored: unknown, today: string, cap = TTS_DAILY_CAP): TtsUsage | null {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  const count = s.date === today && typeof s.count === "number" ? s.count : 0;
  if (count >= cap) return null;
  return { date: today, count: count + 1 };
}
