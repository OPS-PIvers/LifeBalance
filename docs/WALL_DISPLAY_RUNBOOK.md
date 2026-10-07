# Wall Display Runbook

How to set up, pair, and look after the LifeBalance wall display: a
1st-generation iPad Pro 12.9" on the wall, running the app as a Home Screen
web app. The design and the reasons behind each choice are in
[`plans/wall-display-kiosk.md`](plans/wall-display-kiosk.md).

## 1. One-time server setup (an admin, once per Firebase project)

Pairing mints a Firebase **custom token** for the iPad. Cloud Functions (2nd
gen) run as the project's default compute service account, which can't sign
custom tokens until it's allowed to:

```sh
PROJECT=lifebalance-26080
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${NUMBER}-compute@developer.gserviceaccount.com"

gcloud services enable iamcredentials.googleapis.com --project "$PROJECT"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project "$PROJECT" \
  --member "serviceAccount:${SA}" \
  --role roles/iam.serviceAccountTokenCreator
```

Or in the Google Cloud console: **IAM & Admin → Service Accounts →** the
`…-compute@developer.gserviceaccount.com` account **→ Permissions → Grant
access**, principal = the same account, role **Service Account Token Creator**.
Then **APIs & Services → Enable APIs** → **IAM Service Account Credentials API**.

If this step is missing, entering a code on the iPad shows "The server can't
create display sign-ins yet". The code stays valid, so fix the role and try
the same code again (within its 10 minutes).

**Spoken replies** use Google Cloud Text-to-Speech through the `walltts`
function, signed in as the same service account (no API key). Turn the API on
once:

```sh
gcloud services enable texttospeech.googleapis.com --project "$PROJECT"
```

Or in the console: **APIs & Services → Enable APIs → Cloud Text-to-Speech
API**.

**Travel times** for starting-soon alerts use Google's **Routes API**, the
same way:

```sh
gcloud services enable routes.googleapis.com --project "$PROJECT"
```

Until it's on, Settings → Wall display → Starting-soon alerts says so, and
alerts fall back to the lead time. A family's lookups (about two per event
with a location) stay well inside Google's free monthly allowance. Without it the wall still talks, in the iPad's own (more robotic)
voice. A household can use up to 500 spoken phrases a day; typical use is
well under 100, inside Google's free monthly allowance.

## 2. Prepare the iPad

1. **Update** to the latest iPadOS 16.7.x if you can: Settings → General → Software Update. The wall also runs on 16.2 or later, so a failed update isn't a blocker.
2. **Never lock:** Settings → Display & Brightness → Auto-Lock → **Never**.
3. **Auto-Brightness off:** Settings → Accessibility → Display & Text Size → Auto-Brightness off.
4. Open Safari, go to the LifeBalance site, then Share → **Add to Home Screen**.
5. **Open LifeBalance from the Home Screen icon.** From here on, only ever use
   the icon. iPadOS keeps the Home Screen app's sign-in separate from Safari's.

## 3. Pair it

1. On the iPad (Home Screen app), tap **Set up a wall display** under the sign-in button.
2. On your phone: **Settings → Wall display → Add a wall display**, name it
   (e.g. "Kitchen iPad") and tap **Get a code**. Only household admins can do this.
3. Type the 6-digit code on the iPad. It works once and expires after 10 minutes.

The iPad switches to the wall. From then on, it reopens straight to the wall,
even after a restart.

## 4. Lock it down (Guided Access)

1. Settings → Accessibility → **Guided Access** on. Set a passcode.
   Under **Display Auto-Lock**, choose **Never**.
2. Open the LifeBalance icon, then triple-click the top button → **Start**.

To leave Guided Access, triple-click the top button and enter its passcode.

## 5. Overnight brightness (optional)

A web page can't change the backlight. Two Shortcuts **Personal Automations** can:

- **Time of Day** = when night starts (10:00 PM by default) → **Set Brightness 0%**.
- **Time of Day** = when night ends (6:00 AM) → **Set Brightness 70%**.

Turn **Ask Before Running** off on both. If they don't fire under Guided
Access on your iPad (Phase 0 check 5), set a low fixed brightness instead.
The wall still switches to its dim night clock on its own.

## 6. Day to day

- **Settings → Wall display** on any phone: which modules the week's right
  side starts with, auto-rotate and its interval, "back to calendar after",
  night hours, light/dark, text size and weather location.
- **On the wall:** each module's **Switch** and **×** change this wall's
  layout (it remembers it); remove both for a bigger Today-only screen.
  Rotation pauses when someone touches the wall and resumes once it's idle.
- **Lists on the wall:** tap to check off or complete, swipe a row left for
  Delete, **+ Add** for the entry sheet, **Clear (n)** for what's in the cart.
  Every change shows an **Undo** for 10 seconds. A kid's to-do credits their
  points exactly as on the phone, and Undo takes them back. Meals are
  read-only: tap a dinner for its recipe and "Add N missing to Shopping".
- **Gear button** (bottom of the wall's left rail): sync calendars now, test sound, start or stop rotating, reload, or unpair. It
  asks for the **family PIN** when one is set (Settings → Household → Wall
  display → Family PIN; it's the same PIN as Kid Mode's). Without a PIN,
  anyone at the wall can open it.
- **Last seen** on the phone turns red when the wall hasn't checked in for
  30 minutes (it checks in every 5).
- **App updates:** the wall checks for a new version every 10 minutes. When
  one is out it shows **An update is available** at the bottom, like the
  phone app: **Update** reloads now, **Later** hides it for that version.
  Either way it installs itself overnight while the night screen is up.
  There's no other scheduled reload. After tapping Update, touch the screen
  once more to turn sound back on.
- **Sound:** iPadOS keeps a web app silent until someone touches the screen
  after it launches or reloads. While that's the case the wall shows **Tap to
  turn on sound** at the bottom left; any touch turns it on. Settings → Wall
  display → Sound sets the volume (on top of the iPad's own) and whether a
  voice command gets a spoken reply or just a chime. **Test sound** in the
  gear menu plays both.
- **Starting-soon alerts:** turn them on per calendar (Settings → Wall
  display → Calendars → Edit → Starting-soon alerts, plus how its people get
  there: drive, walk, bike or transit). An admin enters the **home address**
  under Starting-soon alerts; it stays on the server. For an event with a
  location the wall shows a big card **10 minutes before it's time to leave**
  ("Leave in 10 min · Leave by 4:10 PM · 20 min drive", live traffic,
  rechecked about 90 minutes before), then **"Time to leave"**. Events with
  no location (or no home address) alert once, a set number of minutes
  before they start. Each card chimes, reads itself out (unless Sound says
  chime only) and stays a minute; **Got it** closes it. During night hours
  the card shows over the night screen with no sound.
- For a nicer built-in fallback voice, download one on the iPad: Settings →
  Accessibility → Spoken Content → Voices → English → an **Enhanced** or
  **Premium** voice. The wall picks it automatically.

### Voice

Voice runs entirely on the iPad: **openWakeWord** listens for the wake word
and **Vosk** turns the command into text. There's no account or key, nothing
you say is sent anywhere, and it never uses the AI allowance. The models are
served with the app (the deploy downloads them; see `pnpm voice:assets`).

1. On the wall, tap the screen once after it starts (iPadOS needs a touch
   before it plays sound or listens), and allow the microphone when asked.
2. The first time, the wall downloads its speech model (41 MB, once; the
   banner says "Getting voice ready"). After that it's stored on the iPad.
3. Hands-free is on by default with the built-in word **"Hey Jarvis"**
   (also: "Hey Mycroft", "Hey Rhasspy"). The rail shows the word under the
   mic while it's listening. It doesn't listen during night hours.

Say the wake word, wait for the short chime, then the command. Or tap the
**mic** at the bottom of the rail (or in the Add sheet).

| Say | What happens |
|---|---|
| "Add milk, eggs and two avocados" / "We need paper towels" / "Put bread on the list" | Adds to Shopping (catalog store and category) |
| "Remind Sam to feed the cat tomorrow" / "Add a to-do to call the dentist on Friday" / "Sam needs to clean his room tonight" | To-do for Sam, due that day (no name = Family, no day = today) |
| "Show the calendar / month / today / shopping / to-dos / meals" | Switches the screen |
| "Stop rotating" / "Start rotating" | Same as the gear menu |
| "Undo" | Removes what voice just added |
| "What's my day?" / "Good morning" / "What's tomorrow?" | Shows and reads the day brief: weather, what's left on the calendar, bills due, leave-by times. After 6 pm "my day" means tomorrow |

- A result opens as a **big card** in the middle of the screen (readable from
  across the room) with a chime, and by default a spoken reply ("Added milk
  and eggs to shopping."). After 5 seconds it shrinks to the bottom banner;
  **Undo** and **Show list** stay for 10 seconds in all.
- Wording the wall can't read shows **Didn't catch that** with what it heard.
  Say it more plainly ("add …", "remind … to …"). Names are the hardest part
  for the small speech model; a to-do whose name it misses goes to Family.
- iPadOS asks for the microphone once per launch. If you tapped Don't Allow,
  go to iPad Settings → Safari → Microphone and choose Ask or Allow.
- **How it listens** (Settings → Wall display → Voice):
  - **Auto** / **On-device**: openWakeWord + Vosk on the iPad.
  - **Safari**: Safari's own recognizer — by far the most accurate. It
    **doesn't work in a Home Screen app** (it never hears anything; the wall
    says so after a few seconds), so open the wall in a **Safari tab**
    instead: pair it from Safari (Safari keeps its own sign-in), keep that tab
    open, and let Guided Access hold it there. The first touch makes the page
    full screen (no address bar); a reload ends that, and the next touch
    brings it back. Set iPad Settings → Safari → Microphone → **Allow** so it
    never asks again. The **Hands-free** wake word still runs on the iPad:
    after "Hey Jarvis" it lets go of the mic, Safari hears the command, then
    it listens again — so pause for the chime before speaking. Commands the
    wall's grammar can't read go to Gemini (AI allowance).
  - **Recording**: sends each command to Gemini and uses the daily AI
    allowance.
  - **Off** hides the mic.
- **Hands-free** and the **sensitivity** are in the same section. Raise the
  sensitivity if it misses you from across the room; lower it if it wakes
  by mistake.

**Your own wake word ("Hey Home")** — free, about 2½ hours of waiting:

1. Open the notebook at
   [github.com/alfiedennen/openwakeword-colab-2026](https://github.com/alfiedennen/openwakeword-colab-2026)
   (**Open in Colab**). It's a maintained fix of openWakeWord's own training
   notebook, which no longer runs.
2. Runtime → Change runtime type → **T4 GPU** (free).
3. In the cell that sets them, change the two lines to
   `TARGET_PHRASE = ['hey home']` and `MODEL_NAME = 'hey_home'`.
4. Runtime → **Run all**. Keep the tab open in front (the free tier
   disconnects a background tab). At the end it downloads `hey_home.onnx`
   (about 0.9 MB).
5. On a phone: Settings → Wall display → Voice → **My own word (.onnx)**: name
   it "Hey Home" and choose the file. The wall switches within seconds.

## 7. Calendars

An admin adds calendars on a phone: **Settings → Wall display → Calendars →
Add a calendar link**. Paste the link, name it, and pick whose it is (the
owner's color marks its events). The link is checked before it's saved, so a
bad one fails right there with the reason.

| Calendar | Where the link is |
|---|---|
| Google | calendar.google.com → the calendar's **Settings and sharing** → **Secret address in iCal format**. Use the *secret* address; the public one only works for public calendars. |
| iCloud | Calendar app → the calendar's **(i)** → **Public Calendar** on → **Share Link**. The `webcal://` link is fine as is. |
| School, team, league | Their **Subscribe**, **iCal** or **.ics** link. |

- Calendars sync every 15 minutes, for households with a paired wall.
  **Sync now** (Settings, or the wall's gear menu) runs one right away, at
  most once every 2 minutes.
- **US holidays** and **Bills on calendar** are toggles in the same section.
  Bills show their name only; amounts never reach the wall.
- A link is a password to that calendar: it's stored where neither the app
  nor the wall can read it back. If one leaks, reset it at the source (Google:
  **Reset** next to the secret address), then **Edit** the calendar here and
  paste the new link.
- If a calendar fails for a day, admins get a push and its line turns red:
  "Hasn't updated since … · re-paste the link".

## 8. Revoke or replace

- Phone: Settings → Wall display → **Revoke** next to the display. The wall
  loses access on its next request and goes back to its pairing screen.
- On the wall: gear → **Unpair this iPad** signs it out and turns it back
  into an ordinary LifeBalance install.

## 9. Hardware care

The 2015 battery is on the charger permanently. **Check the case edges
monthly** for swelling: a bulge, or the screen lifting at a corner. If you
see one, unplug it and retire the iPad. A smart plug that cuts power for a
couple of hours each night is optional extra protection.
