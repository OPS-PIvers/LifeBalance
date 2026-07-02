import React, { useState } from 'react';
import {
  ChevronDown,
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
} from 'lucide-react';
import { getQuickAddEndpointUrl } from '@/services/apiKeyService';
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
  endpoint: 'habit' | 'expense' | 'shopping' | 'naturalLanguage';
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
 * A full-width tappable row that copies a literal value. When `disabled` (e.g. the
 * Authorization row before a key exists), it shows the placeholder but isn't
 * copyable — copying `Bearer YOUR_API_KEY` would only mislead.
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
    className={`group w-full flex items-center gap-3 rounded-btn border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-3 py-2 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900 ${
      disabled
        ? 'opacity-70 cursor-not-allowed'
        : 'hover:border-accent-300 dark:hover:border-accent-500/50 hover:bg-accent-50/60 dark:hover:bg-accent-500/5'
    }`}
  >
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-500">
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

/** One JSON body field, rendered per its mode (copy / type your own / pick variable). */
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
        className="group w-full flex items-center gap-3 rounded-btn border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-3 py-2 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-accent-300 dark:hover:border-accent-500/50 hover:bg-accent-50/60 dark:hover:bg-accent-500/5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
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
    <div className="w-full flex items-start gap-3 rounded-btn border border-dashed border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-brand-800/60 px-3 py-2">
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
      <span className="shrink-0 mt-0.5 text-brand-400 dark:text-brand-500">
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
      {children && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  </li>
);

/** Section eyebrow between step groups (numbering continues across groups). */
const PartLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-2">
    {children}
  </p>
);

/** Short bullet list for "Before you start" / "Good to know". */
const NoteList: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div className="rounded-btn border border-warm-200 dark:border-warm-500/30 bg-warm-50 dark:bg-warm-500/10 p-3">
    <p className="text-xs font-semibold uppercase tracking-wider text-warm-700 dark:text-warm-300 mb-1.5">
      {title}
    </p>
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-warm-800 dark:text-warm-200 leading-relaxed">
          <span className="shrink-0 mt-2 w-1 h-1 rounded-full bg-warm-500 dark:bg-warm-400" />
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
        text: 'Add **Get Text from Input** — this turns the incoming email into plain text the next steps can search.',
      },
      {
        text: 'Add **Match Text** and paste the **Amount** pattern below into its **Match** slot. It automatically searches the text from the previous step.',
        copy: [
          {
            label: 'Amount pattern',
            value: '(?<=purchase of \\$)[\\d,]+\\.\\d{2}',
            hint: 'Finds “6.02” in “purchase of $6.02” (and ignores the “over $1.00” in the subject).',
          },
        ],
      },
      {
        text: 'Add **Get Item from List** (set to **First Item**), then **Set Variable** → call it **Amount**.',
      },
      {
        text: 'Repeat that three-action block (**Match Text** → **Get Item from List** → **Set Variable**) three more times with the patterns below, naming the variables **Merchant**, **Card**, and **Date**. Important: in each new **Match Text**, tap its **Text** slot and re-select the **Text** output from the “Get Text from Input” step — otherwise it searches the wrong thing.',
        copy: [
          {
            label: 'Merchant pattern',
            value: '(?<=Merchant: ).*',
            hint: 'Grabs the store name after “Merchant:” (e.g. “Google CLOUD”).',
          },
          {
            label: 'Card pattern',
            value: '(?<=card )\\D*\\d{4}',
            hint: 'Grabs “...8899” after “credit card” — LifeBalance keeps just the 4 digits.',
          },
          {
            label: 'Date pattern',
            value: '\\d{2}/\\d{2}/\\d{4}',
            hint: 'Grabs the purchase date, e.g. “07/01/2026”.',
          },
        ],
      },
    ],
    fields: [
      { key: 'amount', type: 'Number', mode: 'variable', value: 'Amount' },
      { key: 'merchant', type: 'Text', mode: 'variable', value: 'Merchant' },
      {
        key: 'cardLast4',
        type: 'Text',
        mode: 'variable',
        value: 'Card',
        hint: 'Routes the expense to the account whose Card Digits match.',
      },
      {
        key: 'date',
        type: 'Text',
        mode: 'variable',
        value: 'Date',
        hint: 'The purchase date from the email — MM/DD/YYYY is fine.',
      },
      {
        key: 'fromBankNotification',
        type: 'Text',
        mode: 'copy',
        value: 'true',
        hint: 'Fills a matching Apple Pay $0 hold instead of adding a duplicate.',
      },
    ],
    finishSteps: [
      {
        text: 'Tap **Done**. Each purchase email now becomes a pending transaction on the matching card — review it in the **Budget** tab.',
      },
    ],
    after: [
      '**No Email trigger on your iOS?** Build the exact same actions as a regular shortcut, tap ⓘ → turn on **Show in Share Sheet**, then open an alert email → **Share** → run the shortcut.',
      'If Wells Fargo rewords the email, the patterns may need a tweak — check what each variable captured after a real run.',
      '**Plaid** (Budget tab) is the zero-maintenance alternative for settled amounts.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ShortcutSetupGuideProps {
  /** The API key generated this session (write-once), so the Authorization header can be pre-filled and copied. */
  apiKey?: string | null;
}

const ShortcutSetupGuide: React.FC<ShortcutSetupGuideProps> = ({ apiKey }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const authValue = apiKey ? `Bearer ${apiKey}` : 'Bearer YOUR_API_KEY';

  return (
    <div className="space-y-4">
      {/* How it works */}
      <div className="rounded-card border border-accent-200 dark:border-accent-500/30 bg-accent-50 dark:bg-accent-500/10 p-3">
        <h4 className="font-semibold text-accent-800 dark:text-accent-200 mb-1">How it works</h4>
        <p className="text-sm text-accent-700 dark:text-accent-300 leading-relaxed">
          Every shortcut here does the same thing: it sends one web request to LifeBalance. Pick
          one below and follow its steps top to bottom — anything in a box is tap-to-copy, so you
          never have to type the fiddly parts.
        </p>
      </div>

      {/* API-key / Authorization status — the one value every shortcut needs */}
      {apiKey ? (
        <div className="rounded-card border border-money-pos/40 bg-money-pos/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-money-pos shrink-0" />
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
              Your API key is ready
            </p>
          </div>
          <p className="text-sm text-brand-600 dark:text-brand-300">
            Every shortcut below uses this same Authorization value — it&apos;s pre-filled into the
            steps for you. It won&apos;t be shown again after you leave this screen.
          </p>
          <CopyRow label="Authorization header" value={authValue} />
        </div>
      ) : (
        <div className="rounded-card border border-warm-200 dark:border-warm-500/30 bg-warm-50 dark:bg-warm-500/10 p-3">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-warm-600 dark:text-warm-300 shrink-0" />
            <p className="text-sm font-semibold text-warm-800 dark:text-warm-200">
              Generate an API key first
            </p>
          </div>
          <p className="text-sm text-warm-700 dark:text-warm-300 leading-relaxed">
            Scroll up to <strong>API Keys → Generate New API Key</strong>. Once created, every
            shortcut below is pre-filled with it — ready to copy step by step.
          </p>
        </div>
      )}

      {/* Shortcut list */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
          Shortcuts &amp; automations
        </p>

        {EXAMPLES.map((ex) => {
          const isOpen = expandedId === ex.id;
          // Numbering runs continuously across the three step groups.
          const requestStart = ex.setupSteps.length;
          const finishStart = requestStart + 4;
          return (
            <div key={ex.id} className="surface-section overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : ex.id)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between gap-3 p-3 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 text-accent-600 dark:text-accent-400">{ex.icon}</div>
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-brand-900 dark:text-brand-100 truncate">
                        {ex.title}
                      </p>
                      {ex.isRecommended && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-accent-100 dark:bg-accent-500/20 text-accent-700 dark:text-accent-300 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5">
                          <Sparkles className="w-2.5 h-2.5" />
                          Best
                        </span>
                      )}
                      {ex.isAutomation && (
                        <span className="shrink-0 rounded-full border border-brand-300 dark:border-brand-600 text-brand-500 dark:text-brand-400 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5">
                          Automation
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-brand-500 dark:text-brand-400 line-clamp-2">
                      {ex.description}
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`shrink-0 w-5 h-5 text-brand-400 dark:text-brand-500 transition-transform duration-(--duration-base) ease-spring ${
                    isOpen ? 'rotate-180 text-accent-600 dark:text-accent-400' : ''
                  }`}
                />
              </button>

              {isOpen && (
                <div className="border-t border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-900/40 p-3 space-y-5">
                  {ex.before && <NoteList title="Before you start" items={ex.before} />}

                  {/* Part 1 — create the shortcut / automation */}
                  <div>
                    <PartLabel>
                      {ex.isAutomation ? 'Set up the automation' : 'Build the shortcut'}
                    </PartLabel>
                    <ol className="space-y-2.5">
                      {ex.setupSteps.map((step, i) => (
                        <NumberedStep key={i} n={i + 1} text={step.text}>
                          {step.copy?.map((s) => (
                            <CopyRow key={s.label} label={s.label} value={s.value} hint={s.hint} />
                          ))}
                        </NumberedStep>
                      ))}
                    </ol>
                  </div>

                  {/* Part 2 — the web request (same 4 steps for every shortcut) */}
                  <div>
                    <PartLabel>Send it to LifeBalance</PartLabel>
                    <ol className="space-y-2.5">
                      <NumberedStep
                        n={requestStart + 1}
                        text="Add **Get Contents of URL**. Tap its pale **URL** text and paste:"
                      >
                        <CopyRow label="URL" value={getQuickAddEndpointUrl(ex.endpoint)} />
                      </NumberedStep>
                      <NumberedStep
                        n={requestStart + 2}
                        text="Tap the **› arrow** on that action to expand its options, then change **Method** from GET to **POST**."
                      />
                      <NumberedStep
                        n={requestStart + 3}
                        text="Tap **Headers** → **Add new header**, twice. Type each header’s name on the left and paste its value on the right:"
                      >
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
                      </NumberedStep>
                      <NumberedStep
                        n={requestStart + 4}
                        text="Tap **Request Body** (keep it on **JSON**) → **Add new field**, once per field below. Pick the type on the chip, type the name exactly as shown, then set the value:"
                      >
                        {ex.fields.map((f) => (
                          <FieldRow key={f.key} field={f} />
                        ))}
                      </NumberedStep>
                    </ol>
                  </div>

                  {/* Part 3 — finish */}
                  <div>
                    <PartLabel>Finish up</PartLabel>
                    <ol className="space-y-2.5">
                      {ex.finishSteps.map((step, i) => (
                        <NumberedStep key={i} n={finishStart + i + 1} text={step.text}>
                          {step.copy?.map((s) => (
                            <CopyRow key={s.label} label={s.label} value={s.value} hint={s.hint} />
                          ))}
                        </NumberedStep>
                      ))}
                    </ol>
                  </div>

                  {ex.after && <NoteList title="Good to know" items={ex.after} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lock Screen tip */}
      <div className="rounded-card border border-warm-200 dark:border-warm-500/30 bg-warm-50 dark:bg-warm-500/10 p-3">
        <div className="flex items-start gap-2">
          <Smartphone className="w-5 h-5 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-warm-800 dark:text-warm-200">Lock Screen shortcuts</h4>
            <p className="text-sm text-warm-700 dark:text-warm-300 mt-1">
              Swap the flashlight or camera button for a shortcut: long-press the Lock Screen →
              Customize → tap a button.
            </p>
          </div>
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
    </div>
  );
};

export default ShortcutSetupGuide;
