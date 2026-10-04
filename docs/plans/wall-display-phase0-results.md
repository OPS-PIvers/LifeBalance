# Wall Display, Phase 0 results

> **Status:** lab built, device run **not started**. This file records the
> device spike from [`wall-display-kiosk.md`](wall-display-kiosk.md) §6. Fill
> in each section on the real iPad, then apply the decision rule at the
> bottom. Phases 1–6 shipped without waiting for this: both engines are
> in the wall, and **Settings → Wall display → Voice → How it listens**
> applies the verdict (Auto / iPad = engine A / Recording = engine B / Off).

## What was built

- `#/wall-lab` (only in builds with `VITE_WALL_LAB=true`), signed in as a
  normal member. Tabs:
  - **Environment:** user agent, standalone yes/no, viewport, the Safari
    16.4 feature probes, a persistent device-event log (launches,
    visibility, pageshow/bfcache, online/offline, errors, timer lag) and
    **Copy results as Markdown**.
  - **Mic A · on-device:** `webkitSpeechRecognition` → `parseWallVoiceText`
    (Gemini, text). One recognizer per launch.
  - **Mic B · Gemini audio:** `getUserMedia` + `MediaRecorder` with a level
    detector (1.5 s silence stop, 8 s max, 5 s no-speech stop), re-encoded
    to 16 kHz mono WAV (toggle to send the raw `audio/mp4` instead) →
    `parseWallVoiceAudio` (one Gemini call: transcript + intent). Toggle
    for keeping the mic stream open between commands.
  - **Prototype:** the approved `wall-display-prototype.html`, full-size at
    1366×1024 with the self-hosted fonts, plus theme / text size / offline
    toggles.
  - **Timers:** idle return (configurable), the night window (defaults to
    1–3 min from now so it can be watched), the night screen with tap to
    wake for 60 s, and a timer-lag meter.
- Every attempt is stored on the iPad (localStorage), so scores survive
  cold launches. Mark each one Correct or Wrong by hand.
- **Latency** is measured from the end of speech to the intent on screen.
  For A, "end of speech" is the earliest of `speechend`, the final result
  and `end`. For B, it's the last loud audio frame, so B's figure includes
  its 1.5 s silence wait. That's what a person standing at the wall feels.
- `geminiproxy` now rejects requests carrying more than 2 MB of base64
  inline audio, before the quota is spent.
- `firebase.json` `Permissions-Policy` now allows `microphone=(self)` (it
  was `microphone=()`, which blocks the mic on every page, preview channels
  included).

## How to run it

1. Update the iPad to the latest **iPadOS 16.7.x** (Settings → General →
   Software Update). Record the exact version below.
2. Merge this PR, so `geminiproxy`'s audio guard and the
   `Permissions-Policy` change are deployed.
3. GitHub → Actions → **Wall lab preview (Phase 0)** → Run workflow (on
   `main`). The run summary prints the lab URL.
4. (Nothing to do for sign-in: the preview deploy adds its own domain to
   Firebase Auth's authorized domains and removes it when the channel expires.)
5. On the iPad, open the URL in Safari, sign in, then Share → **Add to Home
   Screen**. Open it from the Home Screen icon and sign in again (standalone
   apps have their own storage).
6. Connect the iPad to a Mac: iPad Settings → Safari → Advanced → **Web
   Inspector** on; Mac Safari → Settings → Advanced → Show Develop menu;
   Develop → *iPad* → the lab page. Keep the console open for check 1.
7. Run the checks below. When done, Environment → **Copy results as
   Markdown** and paste it into the Raw export section at the end of this
   file.

## Device

| Item | Value |
|---|---|
| Model | iPad Pro 12.9" (1st gen) |
| iPadOS version | |
| Safari user agent | |
| Date of run | |

## Checks

| # | Check | Pass criteria | Result | Notes |
|---|---|---|---|---|
| 1 | Loads in Safari and standalone | No blank screen, no console errors | | |
| 2 | Mic A in standalone, 3 cold launches + 1 after overnight | 9/10 correct from 3 m, median ≤ 3 s, works every launch | | |
| 3 | Mic B in standalone, same | 9/10 correct, median ≤ 5 s | | |
| 4 | Mic permission | ≤ 1 prompt per launch; Guided Access doesn't block it | | |
| 5 | Shortcuts brightness automations under Guided Access | Brightness changes on schedule without unlocking | | |
| 6 | 72 h soak (Timers tab open, Auto-Lock Never) | Responsive, memory stable, no reload loops | | |

Extra observations to note:
- Does the orange mic indicator stay lit while "Keep mic open" is on? (If
  yes, the wall releases the mic after each command; plan §4.10.)
- Does Mic B's WAV re-encode work, or did the attempts fall back to
  `audio/mp4`? Does raw `audio/mp4` (toggle off) also parse?
- Prototype tab: fonts are Besley/Schibsted (not Georgia/system), the
  `color-mix` mic ring and sticky day headers in Coming up render, Dark and
  Large look right.

## Decision

- **Engine A** if checks 2 and 4 pass (B becomes the automatic fallback on
  `not-allowed` / `service-not-allowed`).
- **Engine B** if only 3 and 4 pass.
- **Neither:** v1 ships with tap-to-talk off, and the voice decision goes
  back to the owner.
- Check 5 failing: the night screen still ships; the runbook says to set a
  low fixed brightness.

Chosen engine: **(pending)**

## Raw export

(paste the lab's Markdown export here)
