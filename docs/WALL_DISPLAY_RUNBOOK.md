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

## 2. Prepare the iPad

1. **Update** to the latest iPadOS 16.7.x: Settings → General → Software Update.
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
- **Gear button** (bottom of the wall's left rail): sync calendars now, start or stop rotating, reload, or unpair. It
  asks for the **family PIN** when one is set (Settings → Household → Wall
  display → Family PIN; it's the same PIN as Kid Mode's). Without a PIN,
  anyone at the wall can open it.
- **Last seen** on the phone turns red when the wall hasn't checked in for
  30 minutes (it checks in every 5).
- The wall reloads itself once a night at 3 am and picks up app updates silently.

### Voice

Tap the **mic** at the bottom of the rail, or the mic in the Add sheet, and speak:

| Say | What happens | Uses AI? |
|---|---|---|
| "Add milk, eggs and two avocados" | Adds to Shopping (catalog store and category) | Yes |
| "Remind Sam to feed the cat tomorrow" | To-do for Sam, due tomorrow (no name = Family, no day = today) | Yes |
| "Show the calendar / month / today / shopping / to-dos / meals" | Switches the screen | No |
| "Stop rotating" / "Start rotating" | Same as the gear menu | No |
| "Undo" | Removes what voice just added | No |

- The banner shows **Undo** and **Show list** for 10 seconds after an add.
- Voice adds use the household's **daily AI allowance**, the same one the
  phone uses. Settings → Wall display → Voice shows how much is left.
- iPadOS asks for the microphone the first time voice is used after each
  launch. Allow it. If you tapped Don't Allow, go to iPad Settings → Safari →
  Microphone and choose Ask or Allow.
- **How it listens** (Settings → Wall display → Voice):
  - **Auto** uses the iPad's own speech recognition, and switches to recording
    if that's refused.
  - **iPad** and **Recording** force one method.
  - Pick whichever passed the Phase 0 test (`plans/wall-display-phase0-results.md`).
  - **Off** hides the mic.

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
