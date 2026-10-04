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

- **Settings → Wall display** on any phone: night hours, light/dark, text
  size, weather location, and "back to calendar after".
- **Gear button** (bottom of the wall's left rail): reload, or unpair. It
  asks for the **family PIN** when one is set (Settings → Household → Wall
  display → Family PIN; it's the same PIN as Kid Mode's). Without a PIN,
  anyone at the wall can open it.
- **Last seen** on the phone turns red when the wall hasn't checked in for
  30 minutes (it checks in every 5).
- The wall reloads itself once a night at 3 am and picks up app updates silently.

## 7. Revoke or replace

- Phone: Settings → Wall display → **Revoke** next to the display. The wall
  loses access on its next request and goes back to its pairing screen.
- On the wall: gear → **Unpair this iPad** signs it out and turns it back
  into an ordinary LifeBalance install.

## 8. Hardware care

The 2015 battery is on the charger permanently. **Check the case edges
monthly** for swelling: a bulge, or the screen lifting at a corner. If you
see one, unplug it and retire the iPad. A smart plug that cuts power for a
couple of hours each night is optional extra protection.
