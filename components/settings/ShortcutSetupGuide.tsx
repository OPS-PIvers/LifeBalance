import React, { useState } from 'react';
import {
  Smartphone,
  Mic,
  ShoppingCart,
  ExternalLink,
  Copy,
  CreditCard,
  MessageSquare,
  Mail,
  CheckCircle2,
  KeyRound,
  Sparkles,
  Pencil,
  MousePointerClick,
  ReceiptText,
} from 'lucide-react';
import { getQuickAddEndpointUrl } from '@/services/apiKeyService';
import { SurfaceList, DisclosureRow } from '@/components/ui/Section';
import { Drawer } from '@/components/ui/Drawer';
import toast from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** A tap-to-copy value attached to a specific step. */
interface CopyableSnippet {
  label: string;
  value: string;
  hint?: string;
}

/**
 * One JSON body field. `mode` controls how the value is presented:
 * - 'copy'     → a literal the user taps to copy
 * - 'typeIn'   → a placeholder the user replaces with their own value
 * - 'variable' → a Shortcuts variable the user picks from the variable bar
 */
interface FieldSpec {
  key: string;
  type: 'Text' | 'Number';
  mode: 'copy' | 'typeIn' | 'variable';
  value: string;
  hint?: string;
}

/** One numbered instruction. `**bold**` marks UI names to look for. */
interface GuideStep {
  text: string;
  copy?: CopyableSnippet[];
}

interface ShortcutExample {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  endpoint: 'habit' | 'expense' | 'shopping' | 'naturalLanguage' | 'bill';
  isAutomation?: boolean;
  isRecommended?: boolean;
  /** Short bullets shown before the steps (prep work, what to expect). */
  before?: string[];
  /** Steps BEFORE the web-request block (create the shortcut, ask for input…). */
  setupSteps: GuideStep[];
  /** JSON body fields, rendered inside the shared request steps. */
  fields: FieldSpec[];
  /** Steps AFTER the web-request block (notification, rename, try it). */
  finishSteps: GuideStep[];
  /** Short bullets shown after the steps (caveats, tips). */
  after?: string[];
}

// ---------------------------------------------------------------------------
// Small presentational primitives (local to the guide)
// ---------------------------------------------------------------------------

const copyText = async (text: string, label: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Failed to copy');
  }
};

/** Renders `**bold**` spans inside step text so UI names stand out. */
const em = (text: string): React.ReactNode =>
  text.split('**').map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-brand-900 dark:text-brand-50">
        {part}
      </strong>
    ) : (
      part
    ),
  );

/**
 * A full-width tappable row that copies a literal value, meant to sit inside a
 * `SurfaceList` (it draws its own top hairline; the first row's is suppressed by
 * the list). When `disabled` (e.g. the Authorization row before a key exists) it
 * shows the placeholder but isn't copyable — copying `Bearer YOUR_API_KEY` would
 * only mislead.
 * NOTE: `outline-hidden` is the correct Tailwind v4 utility (the v4 rename of v3's
 * `outline-none`); it keeps a transparent outline for forced-colors accessibility.
 */
const CopyRow: React.FC<{ label: string; value: string; hint?: string; disabled?: boolean }> = ({
  label,
  value,
  hint,
  disabled,
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => copyText(value, label)}
    className={`group w-full flex items-center gap-3 px-4 py-2.5 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset ${
      disabled ? 'opacity-70 cursor-not-allowed' : 'hover:bg-brand-50 dark:hover:bg-brand-700/40'
    }`}
  >
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-450">
        {label}
      </p>
      <p className="font-mono text-sm text-brand-800 dark:text-brand-100 break-all">{value}</p>
      {hint && <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">{em(hint)}</p>}
    </div>
    {!disabled && (
      <span className="shrink-0 flex items-center gap-1 text-accent-600 dark:text-accent-400 text-xs font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-300">
        <Copy className="w-3.5 h-3.5" />
        Copy
      </span>
    )}
  </button>
);

/** Small "Text" / "Number" chip shown next to a JSON field key. */
const TypeChip: React.FC<{ type: 'Text' | 'Number' }> = ({ type }) => (
  <span className="shrink-0 rounded-full border border-brand-300 dark:border-brand-600 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">
    {type}
  </span>
);

/**
 * One JSON body field, rendered per its mode (copy / type your own / pick
 * variable) as a plain hairline row inside a `SurfaceList` — no bordered pill.
 */
const FieldRow: React.FC<{ field: FieldSpec }> = ({ field }) => {
  const header = (
    <span className="flex items-center gap-2 min-w-0">
      <span className="font-mono text-sm font-semibold text-brand-800 dark:text-brand-100 truncate">
        {field.key}
      </span>
      <TypeChip type={field.type} />
    </span>
  );

  if (field.mode === 'copy') {
    return (
      <button
        type="button"
        onClick={() => copyText(field.value, field.key)}
        className="group w-full flex items-center gap-3 px-4 py-2.5 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          {header}
          <p className="font-mono text-sm text-brand-700 dark:text-brand-200 break-all">
            {field.value}
          </p>
          {field.hint && (
            <p className="text-xs text-brand-500 dark:text-brand-400">{em(field.hint)}</p>
          )}
        </div>
        <span className="shrink-0 flex items-center gap-1 text-accent-600 dark:text-accent-400 text-xs font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-300">
          <Copy className="w-3.5 h-3.5" />
          Copy
        </span>
      </button>
    );
  }

  return (
    <div className="w-full flex items-start gap-3 px-4 py-2.5 hairline-divider">
      <div className="min-w-0 flex-1 space-y-0.5">
        {header}
        {field.mode === 'typeIn' ? (
          <p className="text-sm text-brand-700 dark:text-brand-200">
            Type your own — e.g.{' '}
            <span className="font-mono text-accent-700 dark:text-accent-300">{field.value}</span>
          </p>
        ) : (
          <p className="text-sm text-brand-700 dark:text-brand-200">
            Tap the value → pick{' '}
            <span className="font-mono font-semibold text-accent-700 dark:text-accent-300">
              {field.value}
            </span>{' '}
            from the variable bar above the keyboard
          </p>
        )}
        {field.hint && (
          <p className="text-xs text-brand-500 dark:text-brand-400">{em(field.hint)}</p>
        )}
      </div>
      <span className="shrink-0 mt-0.5 text-brand-400 dark:text-brand-450">
        {field.mode === 'typeIn' ? (
          <Pencil className="w-3.5 h-3.5" />
        ) : (
          <MousePointerClick className="w-3.5 h-3.5" />
        )}
      </span>
    </div>
  );
};

/** A numbered instruction step; extra rows (copy values, fields) nest under the text. */
const NumberedStep: React.FC<{ n: number; text: string; children?: React.ReactNode }> = ({
  n,
  text,
  children,
}) => (
  <li className="flex gap-3">
    <span className="shrink-0 mt-px w-6 h-6 rounded-full bg-accent-100 dark:bg-accent-500/20 text-accent-700 dark:text-accent-300 text-xs font-bold flex items-center justify-center tabular-nums">
      {n}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm text-brand-700 dark:text-brand-200 leading-relaxed">{em(text)}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  </li>
);

/** Section eyebrow between step groups (numbering continues across groups). */
const PartLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-2 px-1">
    {children}
  </p>
);

/** Short bullet list ("Before you start" / "Good to know") — plain, no box. */
const NoteList: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div className="px-1">
    <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-1.5">
      {title}
    </p>
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-brand-600 dark:text-brand-300 leading-relaxed">
          <span className="shrink-0 mt-2 w-1 h-1 rounded-full bg-brand-400 dark:bg-brand-500" />
          <span>{em(item)}</span>
        </li>
      ))}
    </ul>
  </div>
);

// ---------------------------------------------------------------------------
// Guide data
// ---------------------------------------------------------------------------

const NEW_SHORTCUT_STEP =
  'Open the **Shortcuts** app → **Shortcuts** tab → tap **+** in the top corner. You now have a blank shortcut.';

const SHOW_RESPONSE_STEP =
  'Add **Show Notification**. Tap its message text, then pick **Contents of URL** from the variable bar above the keyboard — that shows you LifeBalance’s confirmation.';

const EXAMPLES: ShortcutExample[] = [
  {
    id: 'natural-language',
    title: 'Natural Language Quick Add',
    icon: <Mic className="w-5 h-5" />,
    description:
      'One Siri phrase for everything: “milk and eggs”, “remind me to call mom”, “spent $20 at Chipotle”.',
    endpoint: 'naturalLanguage',
    isRecommended: true,
    setupSteps: [
      { text: NEW_SHORTCUT_STEP },
      {
        text: 'Search for **Ask for Input** in the bar at the bottom and add it. Tap **Prompt** and type the question Siri will ask you:',
        copy: [{ label: 'Prompt', value: 'What would you like to add?' }],
      },
      {
        text: 'Add **Set Variable**. Tap **Variable Name** and call it **Text Input** — this saves your answer so you can plug it into the request below.',
      },
    ],
    fields: [{ key: 'text', type: 'Text', mode: 'variable', value: 'Text Input' }],
    finishSteps: [
      { text: SHOW_RESPONSE_STEP },
      {
        text: 'Tap the shortcut’s name at the top → **Rename** → call it something easy to say, like **Quick Add**.',
      },
      {
        text: 'Done! Say **“Hey Siri, Quick Add”** and speak naturally — try “add milk, eggs, and bread to the shopping list”.',
      },
    ],
    after: [
      'Spoken items are queued for review, not added instantly — open LifeBalance afterwards and it will ask you to confirm them.',
      'This one shortcut covers shopping items, to-dos, and expenses — LifeBalance figures out which you meant from the wording.',
    ],
  },
  {
    id: 'habit',
    title: 'Quick Habit Toggle',
    icon: <Smartphone className="w-5 h-5" />,
    description: 'A one-tap Home Screen button that logs a habit and shows your points and streak.',
    endpoint: 'habit',
    setupSteps: [{ text: NEW_SHORTCUT_STEP }],
    fields: [
      {
        key: 'habitName',
        type: 'Text',
        mode: 'typeIn',
        value: 'Morning Exercise',
        hint: 'Use the habit’s name from your Habits page — close spelling still matches.',
      },
      {
        key: 'direction',
        type: 'Text',
        mode: 'copy',
        value: 'up',
        hint: '“up” logs a completion. Make a second shortcut with “down” to undo one.',
      },
    ],
    finishSteps: [
      {
        text: 'Add **Show Notification**. Tap its message text and pick **Contents of URL** from the variable bar — you’ll see the points and streak you earned.',
      },
      {
        text: 'Tap the shortcut’s name at the top → **Rename** → name it after the habit (e.g. **Log Exercise**).',
      },
      {
        text: 'Tap the name again → **Add to Home Screen** for a true one-tap button. (Want it on the Lock Screen? See the tip at the bottom of this guide.)',
      },
    ],
    after: ['Make one copy of this shortcut per habit — only the **habitName** value changes.'],
  },
  {
    id: 'expense-voice',
    title: 'Voice-Activated Expense',
    icon: <Mic className="w-5 h-5" />,
    description: 'Say “Hey Siri, Log Expense”, answer two questions, and it lands in your Budget tab.',
    endpoint: 'expense',
    setupSteps: [
      { text: NEW_SHORTCUT_STEP },
      {
        text: 'Add **Ask for Input**. Tap **Prompt** and type **How much did you spend?**. Then tap the blue **Text** word in that action and switch it to **Number**.',
      },
      { text: 'Add **Set Variable** → tap **Variable Name** → call it **Amount**.' },
      {
        text: 'Add a second **Ask for Input**. Prompt: **Where did you spend it?** (leave its type as **Text**).',
      },
      { text: 'Add **Set Variable** → call this one **Merchant**.' },
    ],
    fields: [
      { key: 'amount', type: 'Number', mode: 'variable', value: 'Amount' },
      { key: 'merchant', type: 'Text', mode: 'variable', value: 'Merchant' },
      {
        key: 'category',
        type: 'Text',
        mode: 'copy',
        value: 'Dining',
        hint: 'Optional — use any category from your Budget tab, or skip this field and it lands as “Uncategorized”.',
      },
    ],
    finishSteps: [
      { text: SHOW_RESPONSE_STEP },
      { text: 'Tap the shortcut’s name at the top → **Rename** → call it **Log Expense**.' },
      {
        text: 'Say **“Hey Siri, Log Expense”**. The expense appears in the **Budget** tab as “pending review” for you to approve.',
      },
    ],
  },
  {
    id: 'shopping',
    title: 'Voice Shopping List',
    icon: <ShoppingCart className="w-5 h-5" />,
    description: 'Say “Hey Siri, Add to Shopping List”, say the item, and it’s on the list.',
    endpoint: 'shopping',
    setupSteps: [
      { text: NEW_SHORTCUT_STEP },
      { text: 'Add **Ask for Input**. Tap **Prompt** and type **What do you need?**' },
      { text: 'Add **Set Variable** → tap **Variable Name** → call it **Item**.' },
    ],
    fields: [{ key: 'item', type: 'Text', mode: 'variable', value: 'Item' }],
    finishSteps: [
      { text: SHOW_RESPONSE_STEP },
      { text: 'Tap the shortcut’s name at the top → **Rename** → call it **Add to Shopping List**.' },
      {
        text: 'Say **“Hey Siri, Add to Shopping List”**. Saying an item that’s already on the list bumps its quantity instead of duplicating it.',
      },
    ],
  },
  {
    id: 'bill-pay',
    title: 'Voice Bill Pay',
    icon: <ReceiptText className="w-5 h-5" />,
    description: 'Say “Hey Siri, I paid rent” and the matching upcoming bill is marked paid from your checking account.',
    endpoint: 'bill',
    before: [
      'This marks an existing **calendar bill** as paid — it doesn’t create a new bill. Add your recurring bills in the **Budget** tab first.',
      'It draws from your **first checking account** and records a paid transaction dated to when the bill was due.',
    ],
    setupSteps: [
      { text: NEW_SHORTCUT_STEP },
      { text: 'Add **Ask for Input**. Tap **Prompt** and type **Which bill did you pay?** (leave its type as **Text**).' },
      { text: 'Add **Set Variable** → tap **Variable Name** → call it **Bill**.' },
    ],
    fields: [
      {
        key: 'title',
        type: 'Text',
        mode: 'variable',
        value: 'Bill',
        hint: 'Match the bill’s name from your Budget calendar — close spelling still matches (e.g. “rent”, “electric”).',
      },
    ],
    finishSteps: [
      { text: SHOW_RESPONSE_STEP },
      { text: 'Tap the shortcut’s name at the top → **Rename** → call it **Pay Bill**.' },
      {
        text: 'Say **“Hey Siri, Pay Bill”**, name the bill, and it’s marked paid — your checking balance and the calendar update instantly.',
      },
    ],
    after: [
      'Only **unpaid** bills due within about six weeks (past or upcoming) are matched, so an old paid bill is never re-charged.',
      'If two bills share a name, the soonest-due one is paid first.',
      'No match? You’ll get a “no matching unpaid bill” notification and nothing changes.',
    ],
  },
  {
    id: 'wallet-auto',
    title: 'Apple Pay Auto-Log',
    icon: <CreditCard className="w-5 h-5" />,
    description: 'Runs by itself every time you pay with Apple Pay — no tapping, no Siri.',
    endpoint: 'expense',
    isAutomation: true,
    before: [
      'This is an **Automation**, not a regular shortcut — it runs on its own when you pay.',
      'Apple Pay often reports **$0** at first (a pre-authorization hold). LifeBalance keeps those as “awaiting amount” items so the purchase is never lost — the **Bank Text Alert** automation below fills in the real totals automatically.',
    ],
    setupSteps: [
      { text: 'In the **Shortcuts** app, go to the **Automation** tab → tap **+**.' },
      { text: 'Choose **Transaction** from the trigger list.' },
      { text: 'Pick your Apple Pay card(s), select **Run Immediately**, then tap **Next**.' },
      { text: 'Tap **New Blank Automation** — now you’re building the actions it runs.' },
    ],
    fields: [
      {
        key: 'amount',
        type: 'Number',
        mode: 'variable',
        value: 'Shortcut Input',
        hint: 'After inserting it, tap the blue token and choose **Amount**.',
      },
      {
        key: 'merchant',
        type: 'Text',
        mode: 'variable',
        value: 'Shortcut Input',
        hint: 'After inserting it, tap the blue token and choose **Merchant**.',
      },
    ],
    finishSteps: [
      {
        text: 'Tap **Done**. That’s it — pay with your card and the expense appears in the **Budget** tab as pending.',
      },
    ],
    after: [
      'Don’t add an “only if amount is over $0” filter — $0 holds are supposed to go through (they become “awaiting amount” items you can fill in).',
      'Any amount format works: 50, “$50.00”, “(50.00)”, “50,00”.',
    ],
  },
  {
    id: 'bank-text',
    title: 'Bank Text Alert — Real Amounts',
    icon: <MessageSquare className="w-5 h-5" />,
    description: 'Reads the real total from your bank’s text alerts and fills in the $0 Apple Pay holds.',
    endpoint: 'expense',
    isAutomation: true,
    before: [
      'First, turn on **text-message purchase alerts** in your bank’s app or website, and keep a real alert text handy — you’ll match its wording below.',
      'Why texts? iOS can only trigger automations from incoming **Messages** — it can’t react to another app’s push notifications.',
    ],
    setupSteps: [
      { text: 'In the **Shortcuts** app, go to the **Automation** tab → tap **+** → choose **Message**.' },
      {
        text: 'Tap **Message Contains** and type a phrase that appears in every alert (e.g. **purchase**), or set **Sender** to your bank’s alert number.',
      },
      { text: 'Select **Run Immediately** → **Next** → **New Blank Automation**.' },
      {
        text: 'Add **Match Text**. Paste the pattern below into its **Match** slot, then tap its **Text** slot and pick **Shortcut Input** (the incoming text message) from the variable bar:',
        copy: [
          {
            label: 'Amount pattern',
            value: '\\$?\\d[\\d,]*\\.\\d{2}',
            hint: 'Finds “$13.31” anywhere in the alert.',
          },
        ],
      },
      { text: 'Add **Get Item from List** and set it to **First Item**.' },
      { text: 'Add **Set Variable** → call it **Amount**.' },
      {
        text: 'Repeat those three actions for the store name: **Match Text** (pattern below, Text = **Shortcut Input** again) → **Get Item from List** (First Item) → **Set Variable** named **Merchant**.',
        copy: [
          {
            label: 'Merchant pattern',
            value: '(?<= at ).*',
            hint: 'Grabs everything after “ at ” — tweak it once you’ve seen your bank’s exact wording.',
          },
        ],
      },
    ],
    fields: [
      { key: 'amount', type: 'Number', mode: 'variable', value: 'Amount' },
      { key: 'merchant', type: 'Text', mode: 'variable', value: 'Merchant' },
      {
        key: 'fromBankNotification',
        type: 'Text',
        mode: 'copy',
        value: 'true',
        hint: 'Tells LifeBalance to fill a matching $0 Apple Pay hold instead of adding a duplicate.',
      },
    ],
    finishSteps: [
      {
        text: 'Tap **Done**. On your next purchase, the $0 hold and the real amount merge into **one** pending transaction in the Budget tab.',
      },
    ],
    after: [
      'If no recent $0 hold matches, it simply adds a normal pending expense — nothing is lost.',
      'If your bank rewords its alerts, just update the two Match Text patterns.',
      'Want zero upkeep? Connecting your bank through **Plaid** (Budget tab) gets settled amounts automatically.',
    ],
  },
  {
    id: 'wells-fargo-email',
    title: 'Wells Fargo Email Auto-Log',
    icon: <Mail className="w-5 h-5" />,
    description: 'Turns each Wells Fargo purchase email into a pending transaction on the right card.',
    endpoint: 'expense',
    isAutomation: true,
    before: [
      'One-time prep: tell LifeBalance each card’s last 4 digits so emails route to the right account — **Budget tab → account → ⋯ → Add Card Digits**.',
      'Turn on **purchase email alerts** for each card in Wells Fargo online banking.',
      'Keep a real alert email open — you’ll copy its sender address below.',
    ],
    setupSteps: [
      {
        text: 'In the **Shortcuts** app, go to the **Automation** tab → tap **+** → choose **Email**. (No Email option on your iOS? Use the Share Sheet route under “Good to know” below — same actions, run from the email.)',
      },
      {
        text: 'Tap **Sender** and enter the address the alerts come from (check a real alert — usually **alerts@notify.wellsfargo.com**). Tap **Subject Contains** and type **purchase**.',
      },
      { text: 'Select **Run Immediately** → **Next** → **New Blank Automation**.' },
      {
        text: 'Add **Get Text from Input** — this turns the incoming email into plain text. That’s the only preparation: LifeBalance reads the amount, merchant, card, and date out of the email on the server, so there are no patterns to copy.',
      },
    ],
    fields: [
      {
        key: 'emailText',
        type: 'Text',
        mode: 'variable',
        value: 'Text',
        hint: 'Pick the **Text** output of the “Get Text from Input” step — the whole email. LifeBalance extracts the amount, merchant, card digits, and date server-side.',
      },
    ],
    finishSteps: [
      {
        text: 'Add **Show Notification**. Tap its message text and pick **Contents of URL** — after each run you’ll see exactly what LifeBalance extracted.',
      },
      {
        text: 'Tap **Done**. Each purchase email now becomes a pending transaction on the matching card — review it in the **Budget** tab.',
      },
    ],
    after: [
      '**No Email trigger on your iOS?** Build the exact same actions as a regular shortcut, tap ⓘ → turn on **Show in Share Sheet**, then open an alert email → **Share** → run the shortcut.',
      'Email alerts automatically fill a matching Apple Pay **$0 hold** instead of adding a duplicate — no extra field needed.',
      'Gmail / Google Workspace accounts in Apple **Mail** are fetch-only, so the automation may run several minutes after the purchase — whenever Mail actually downloads the message.',
      'If Wells Fargo rewords its emails, there’s nothing to fix on your phone — the server-side parser is updated centrally.',
      '**Plaid** (Budget tab) is the zero-maintenance alternative for settled amounts.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Walkthrough (rendered inside the per-shortcut Drawer)
// ---------------------------------------------------------------------------

const ExampleWalkthrough: React.FC<{
  ex: ShortcutExample;
  authValue: string;
  apiKey?: string | null;
}> = ({ ex, authValue, apiKey }) => {
  // Numbering runs continuously across the three step groups.
  const requestStart = ex.setupSteps.length;
  const finishStart = requestStart + 4;

  return (
    <div className="space-y-6">
      {ex.before && <NoteList title="Before you start" items={ex.before} />}

      {/* Part 1 — create the shortcut / automation */}
      <div>
        <PartLabel>{ex.isAutomation ? 'Set up the automation' : 'Build the shortcut'}</PartLabel>
        <ol className="space-y-4">
          {ex.setupSteps.map((step, i) => (
            <NumberedStep key={i} n={i + 1} text={step.text}>
              {step.copy && (
                <SurfaceList>
                  {step.copy.map((s) => (
                    <CopyRow key={s.label} label={s.label} value={s.value} hint={s.hint} />
                  ))}
                </SurfaceList>
              )}
            </NumberedStep>
          ))}
        </ol>
      </div>

      {/* Part 2 — the web request (same 4 steps for every shortcut) */}
      <div>
        <PartLabel>Send it to LifeBalance</PartLabel>
        <ol className="space-y-4">
          <NumberedStep
            n={requestStart + 1}
            text="Add **Get Contents of URL**. Tap its pale **URL** text and paste:"
          >
            <SurfaceList>
              <CopyRow label="URL" value={getQuickAddEndpointUrl(ex.endpoint)} />
            </SurfaceList>
          </NumberedStep>
          <NumberedStep
            n={requestStart + 2}
            text="Tap the **› arrow** on that action to expand its options, then change **Method** from GET to **POST**."
          />
          <NumberedStep
            n={requestStart + 3}
            text="Tap **Headers** → **Add new header**, twice. Type each header’s name on the left and paste its value on the right:"
          >
            <SurfaceList>
              <CopyRow
                label="Header 1 · Authorization"
                value={authValue}
                hint={
                  apiKey
                    ? 'Name: **Authorization** — tap to copy the value.'
                    : 'Generate a key above and this fills in automatically.'
                }
                disabled={!apiKey}
              />
              <CopyRow
                label="Header 2 · Content-Type"
                value="application/json"
                hint="Name: **Content-Type** — tap to copy the value."
              />
            </SurfaceList>
          </NumberedStep>
          <NumberedStep
            n={requestStart + 4}
            text="Tap **Request Body** (keep it on **JSON**) → **Add new field**, once per field below. Pick the type on the chip, type the name exactly as shown, then set the value:"
          >
            <SurfaceList>
              {ex.fields.map((f) => (
                <FieldRow key={f.key} field={f} />
              ))}
            </SurfaceList>
          </NumberedStep>
        </ol>
      </div>

      {/* Part 3 — finish */}
      <div>
        <PartLabel>Finish up</PartLabel>
        <ol className="space-y-4">
          {ex.finishSteps.map((step, i) => (
            <NumberedStep key={i} n={finishStart + i + 1} text={step.text}>
              {step.copy && (
                <SurfaceList>
                  {step.copy.map((s) => (
                    <CopyRow key={s.label} label={s.label} value={s.value} hint={s.hint} />
                  ))}
                </SurfaceList>
              )}
            </NumberedStep>
          ))}
        </ol>
      </div>

      {ex.after && <NoteList title="Good to know" items={ex.after} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ShortcutSetupGuideProps {
  /** The API key generated this session (write-once), so the Authorization header can be pre-filled and copied. */
  apiKey?: string | null;
}

const ShortcutSetupGuide: React.FC<ShortcutSetupGuideProps> = ({ apiKey }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const openExample = EXAMPLES.find((e) => e.id === openId) ?? null;

  const authValue = apiKey ? `Bearer ${apiKey}` : 'Bearer YOUR_API_KEY';

  return (
    <div className="space-y-5">
      {/* How it works */}
      <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed px-1">
        Every shortcut here does the same thing: it sends one web request to LifeBalance. Pick one
        below and follow its steps top to bottom — tap any highlighted value to copy it, so you
        never have to type the fiddly parts.
      </p>

      {/* API-key / Authorization status — the one value every shortcut needs */}
      {apiKey ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 px-1">
            <CheckCircle2 className="w-4 h-4 text-money-pos dark:text-money-posDark shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
                Your API key is ready
              </p>
              <p className="text-sm text-brand-500 dark:text-brand-400">
                Every shortcut below uses this same Authorization value — it&apos;s pre-filled into the
                steps for you. It won&apos;t be shown again after you leave this screen.
              </p>
            </div>
          </div>
          <SurfaceList>
            <CopyRow label="Authorization header" value={authValue} />
          </SurfaceList>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-1">
          <KeyRound className="w-4 h-4 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-warm-800 dark:text-warm-200">
              Generate an API key first
            </p>
            <p className="text-sm text-warm-700 dark:text-warm-300 leading-relaxed">
              Scroll up to <strong>API Keys → Generate New API Key</strong>. Once created, every
              shortcut below is pre-filled with it — ready to copy step by step.
            </p>
          </div>
        </div>
      )}

      {/* Shortcut list — each row drills into a bottom-sheet walkthrough */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">
          Shortcuts &amp; automations
        </p>
        <SurfaceList>
          {EXAMPLES.map((ex) => (
            <DisclosureRow
              key={ex.id}
              icon={ex.icon}
              title={ex.title}
              subtitle={ex.description}
              onClick={() => setOpenId(ex.id)}
              value={
                ex.isRecommended || ex.isAutomation ? (
                  <span className="flex items-center gap-1">
                    {ex.isRecommended && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 dark:bg-accent-500/20 text-accent-700 dark:text-accent-300 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5">
                        <Sparkles className="w-2.5 h-2.5" />
                        Best
                      </span>
                    )}
                    {ex.isAutomation && (
                      <span className="rounded-full border border-brand-300 dark:border-brand-600 text-brand-500 dark:text-brand-400 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5">
                        Auto
                      </span>
                    )}
                  </span>
                ) : undefined
              }
            />
          ))}
        </SurfaceList>
      </div>

      {/* Lock Screen tip */}
      <div className="flex items-start gap-2 px-1">
        <Smartphone className="w-5 h-5 text-brand-500 dark:text-brand-400 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold text-sm text-brand-900 dark:text-brand-100">Lock Screen shortcuts</h4>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-1">
            Swap the flashlight or camera button for a shortcut: long-press the Lock Screen →
            Customize → tap a button.
          </p>
        </div>
      </div>

      {/* Docs */}
      <a
        href="https://support.apple.com/guide/shortcuts/welcome/ios"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-sm text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 py-2 transition-colors"
      >
        <ExternalLink className="w-4 h-4" />
        Apple Shortcuts documentation
      </a>

      {/* Per-shortcut walkthrough sheet */}
      <Drawer
        isOpen={openExample !== null}
        onClose={() => setOpenId(null)}
        title={openExample?.title}
        height="tall"
      >
        {openExample && (
          <ExampleWalkthrough ex={openExample} authValue={authValue} apiKey={apiKey} />
        )}
      </Drawer>
    </div>
  );
};

export default ShortcutSetupGuide;
