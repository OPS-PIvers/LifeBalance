import React, { useState } from 'react';
import {
  ChevronDown,
  Smartphone,
  Mic,
  ShoppingCart,
  ExternalLink,
  Copy,
  CreditCard,
  Bell,
  CheckCircle2,
  KeyRound,
  Sparkles,
} from 'lucide-react';
import { getQuickAddEndpointUrl } from '@/services/apiKeyService';
import toast from 'react-hot-toast';

interface BodyField {
  key: string;
  /** For a literal field this is the value to copy; for a variable it's the Shortcuts variable name to pick. */
  value: string;
  valueType: 'Text' | 'Number';
  /** True → the user selects a Shortcuts variable (not copyable); false/undefined → a literal value to copy. */
  isVariable?: boolean;
}

interface CopyableSnippet {
  label: string;
  value: string;
  hint?: string;
}

interface ShortcutExample {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  endpoint: 'habit' | 'expense' | 'shopping' | 'naturalLanguage';
  fields: BodyField[];
  /** Steps to build the shortcut/automation BEFORE the "Get Contents of URL" action. */
  buildSteps: string[];
  /** Steps AFTER the request is configured. */
  finishSteps?: string[];
  /** Extra copyable snippets (e.g. a Match Text regex) shown with the build steps. */
  snippets?: CopyableSnippet[];
  isAutomation?: boolean;
  automationNote?: string;
  isRecommended?: boolean;
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

/** A full-width tappable row that copies a literal value. */
const CopyRow: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <button
    type="button"
    onClick={() => copyText(value, label)}
    className="group w-full flex items-center gap-3 rounded-btn border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-3 py-2 text-left hover:border-accent-300 dark:hover:border-accent-500/50 hover:bg-accent-50/60 dark:hover:bg-accent-500/5 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
  >
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-500">
        {label}
      </p>
      <p className="font-mono text-xs text-brand-800 dark:text-brand-100 break-all">{value}</p>
      {hint && <p className="text-[11px] text-brand-500 dark:text-brand-400 mt-0.5">{hint}</p>}
    </div>
    <span className="shrink-0 flex items-center gap-1 text-accent-600 dark:text-accent-400 text-xs font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-300">
      <Copy className="w-3.5 h-3.5" />
      Copy
    </span>
  </button>
);

/** A non-copyable field the user fills from a Shortcuts variable. */
const VariableRow: React.FC<{ label: string; variable: string }> = ({ label, variable }) => (
  <div className="w-full flex items-center gap-3 rounded-btn border border-dashed border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-brand-800/60 px-3 py-2">
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-500">
        {label}
      </p>
      <p className="text-xs text-brand-700 dark:text-brand-200">
        Tap the value → <strong>Select Variable</strong> →{' '}
        <span className="font-mono text-accent-700 dark:text-accent-300">{variable}</span>
      </p>
    </div>
  </div>
);

/** A numbered instruction step. */
const NumberedStep: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <li className="flex gap-3">
    <span className="shrink-0 mt-px w-5 h-5 rounded-full bg-accent-100 dark:bg-accent-500/20 text-accent-700 dark:text-accent-300 text-[11px] font-bold flex items-center justify-center tabular-nums">
      {n}
    </span>
    <span className="text-xs text-brand-600 dark:text-brand-300 leading-relaxed">{children}</span>
  </li>
);

/** Small section eyebrow inside an expanded shortcut. */
const PhaseLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-2">
    {children}
  </p>
);

// ---------------------------------------------------------------------------
// Guide data
// ---------------------------------------------------------------------------

const EXAMPLES: ShortcutExample[] = [
  {
    id: 'natural-language',
    title: 'Natural Language Quick Add',
    icon: <Mic className="w-5 h-5" />,
    description: 'Speak naturally to add shopping items, todos, or expenses — no counting needed',
    endpoint: 'naturalLanguage',
    isRecommended: true,
    fields: [{ key: 'text', value: 'Text Input', valueType: 'Text', isVariable: true }],
    buildSteps: [
      'Add "Ask for Input" → tap the Prompt field → type "What would you like to add?"',
      'Keep it as Text → toggle ON "Allow Speech Input"',
      'Add "Set Variable" → name it "Text Input"',
    ],
    finishSteps: [
      'Add "Show Notification" → it confirms what was queued',
      'Rename the shortcut to "Quick Add to LifeBalance"',
      'Tap the ⓘ icon → toggle ON "Show in Share Sheet" and "Show in App"',
      'Say: "Hey Siri, add milk, eggs, and bread to shopping list"',
    ],
  },
  {
    id: 'habit',
    title: 'Quick Habit Toggle',
    icon: <Smartphone className="w-5 h-5" />,
    description: 'One-tap habit completion from your Lock Screen',
    endpoint: 'habit',
    fields: [
      { key: 'habitName', value: 'Morning Exercise', valueType: 'Text' },
      { key: 'direction', value: 'up', valueType: 'Text' },
    ],
    buildSteps: ['Start a new shortcut in the Shortcuts app'],
    finishSteps: [
      'Add "Show Notification" → its text auto-fills from the API response',
      'Rename the shortcut to "Log Exercise"',
      'Tap the ⋮ menu → "Add to Home Screen" or "Add to Lock Screen"',
    ],
  },
  {
    id: 'expense-voice',
    title: 'Voice-Activated Expense',
    icon: <Mic className="w-5 h-5" />,
    description: '"Hey Siri, log expense" to quickly track spending',
    endpoint: 'expense',
    fields: [
      { key: 'amount', value: 'Amount', valueType: 'Number', isVariable: true },
      { key: 'merchant', value: 'Merchant', valueType: 'Text', isVariable: true },
      { key: 'category', value: 'Dining', valueType: 'Text' },
    ],
    buildSteps: [
      'Add "Ask for Input" → Prompt "How much did you spend?" → change the type to Number',
      'Add "Set Variable" → name it "Amount"',
      'Add "Ask for Input" again → Prompt "Where did you spend it?"',
      'Add "Set Variable" → name it "Merchant"',
    ],
    finishSteps: [
      'Add "Show Notification" → it confirms the expense logged',
      'Rename the shortcut to "Log Expense"',
      'Tap the ⓘ icon → toggle ON "Show in Share Sheet" and "Show in App"',
    ],
  },
  {
    id: 'shopping',
    title: 'Voice Shopping List',
    icon: <ShoppingCart className="w-5 h-5" />,
    description: '"Hey Siri, add to shopping list" for quick grocery adds',
    endpoint: 'shopping',
    fields: [{ key: 'item', value: 'Item', valueType: 'Text', isVariable: true }],
    buildSteps: [
      'Add "Ask for Input" → Prompt "What do you need?"',
      'Add "Set Variable" → name it "Item"',
    ],
    finishSteps: [
      'Add "Show Notification" → it confirms the item added',
      'Rename the shortcut to "Add to Shopping List"',
      'Tap the ⓘ icon → toggle ON "Show in Share Sheet" and "Show in App"',
    ],
  },
  {
    id: 'wallet-auto',
    title: 'Apple Wallet Auto-Log',
    icon: <CreditCard className="w-5 h-5" />,
    description: 'Automatically log expenses when you pay with Apple Pay',
    endpoint: 'expense',
    isAutomation: true,
    fields: [
      { key: 'amount', value: 'Amount', valueType: 'Number', isVariable: true },
      { key: 'merchant', value: 'Merchant', valueType: 'Text', isVariable: true },
    ],
    buildSteps: [
      'Shortcuts app → Automation tab (bottom) → tap + (top right)',
      'Scroll down and tap "Transaction"',
      'Choose your Apple Pay card(s) → tap Next',
      'Set this up before? DELETE any "If Amount > 0" filter — $0 pre-auths now become an "awaiting amount" item you finish in the app, so let every transaction through',
    ],
    finishSteps: [
      'Tap Done → when prompted choose "Run Immediately" (not "Ask Before Running")',
      'Expenses auto-log as pending — review them in the Budget tab',
    ],
    automationNote:
      'The Transaction trigger provides Amount and Merchant automatically. Apple Pay fires it on the authorization event, which is often a $0 pre-authorization hold (the real amount settles later on the bank side and does not re-fire the trigger). A $0 charge with a merchant becomes an "awaiting amount" item you complete later — so do NOT add an "If Amount > 0" filter. Pair this with "Apple Pay Real Amount" below to fill in those real totals automatically. The API accepts 50, -50, "$50.00", "50,00", "1.234,56", and "(50.00)".',
  },
  {
    id: 'wallet-bank-notification',
    title: 'Apple Pay Real Amount',
    icon: <Bell className="w-5 h-5" />,
    description: "Reads the real total from your bank's notification — fills in the $0 holds above",
    endpoint: 'expense',
    isAutomation: true,
    fields: [
      { key: 'amount', value: 'Amount', valueType: 'Number', isVariable: true },
      { key: 'merchant', value: 'Merchant', valueType: 'Text', isVariable: true },
      { key: 'fromBankNotification', value: 'true', valueType: 'Text' },
    ],
    buildSteps: [
      'Turn ON transaction alerts in your bank app first, so each purchase pushes a notification',
      'Shortcuts app → Automation tab → tap + → "When I receive a notification" (needs a recent iOS)',
      'Choose your bank app (e.g. Wells Fargo) → tap Next → set "Run Immediately"',
      'Add "Get Details of Shortcut Input" → pick the notification Title / Body',
      'Add "Match Text" with the Amount regex below → "Get Item from List" → First Item → "Set Variable" named Amount',
      'Capture the store name into a "Set Variable" named Merchant (Split Text by New Lines, then pick the store line)',
      'Run it once on a real notification and tweak until Amount + Merchant come out clean',
    ],
    snippets: [
      {
        label: 'Amount regex (Match Text)',
        value: '\\$?\\d[\\d,]*\\.\\d{2}',
        hint: 'Grabs "$13.31" from the notification text',
      },
    ],
    finishSteps: [
      'Tap Done → choose "Run Immediately"',
      'Keep "fromBankNotification" set to true — that flag fills a $0 hold instead of adding a duplicate',
      'With both automations on, the $0 hold and the real amount merge into ONE pending transaction',
    ],
    automationNote:
      'Companion to the Apple Wallet automation above. Apple Pay only sees the $0 authorization; your bank\'s notification carries the real total — this parses it and sends it. The "fromBankNotification": true flag fills a recent $0 "awaiting amount" hold (by merchant, or by timing when the two apps report different store names) instead of creating a second row; if nothing matches it just adds a normal expense. Caveats: needs a recent iOS that passes notification text into the shortcut; parsing is brittle if your bank rewords alerts; a Focus or Scheduled Summary can delay notifications. For the most reliable settled amounts, connect your bank with Plaid instead — this is the no-Plaid option.',
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
        <p className="text-sm text-accent-700 dark:text-accent-300">
          Each shortcut sends an HTTP request to LifeBalance with your API key. Pick one below and
          copy each value straight into the Shortcuts app — no typing.
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
          <p className="text-xs text-brand-500 dark:text-brand-400">
            Copy the Authorization header once and paste it into every shortcut you build. It won&apos;t
            be shown again after you leave this screen.
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
          <p className="text-xs text-warm-700 dark:text-warm-300">
            Scroll up to <strong>API Keys → Generate New API Key</strong>. Once created, its
            Authorization header appears here — ready to copy into every shortcut below.
          </p>
        </div>
      )}

      {/* Shortcut list */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
          Shortcuts &amp; automations
        </p>

        {EXAMPLES.map((ex) => {
          const isOpen = expandedId === ex.id;
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
                    </div>
                    <p className="text-xs text-brand-500 dark:text-brand-400 line-clamp-2">
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
                  {/* Automation caveat */}
                  {ex.automationNote && (
                    <div className="rounded-btn border border-warm-200 dark:border-warm-500/30 bg-warm-50 dark:bg-warm-500/10 p-2.5">
                      <p className="text-xs text-warm-800 dark:text-warm-300 leading-relaxed">
                        {ex.automationNote}
                      </p>
                    </div>
                  )}

                  {/* Phase 1 — build the shortcut */}
                  <div>
                    <PhaseLabel>1 · {ex.isAutomation ? 'Create the automation' : 'Build the shortcut'}</PhaseLabel>
                    <ol className="space-y-1.5">
                      {ex.buildSteps.map((step, i) => (
                        <NumberedStep key={i} n={i + 1}>
                          {step}
                        </NumberedStep>
                      ))}
                    </ol>
                    {ex.snippets && ex.snippets.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {ex.snippets.map((s) => (
                          <CopyRow key={s.label} label={s.label} value={s.value} hint={s.hint} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Phase 2 — the request */}
                  <div>
                    <PhaseLabel>
                      2 · Add “Get Contents of URL” → tap “Show More”
                    </PhaseLabel>
                    <div className="space-y-2">
                      <CopyRow label="Request URL" value={getQuickAddEndpointUrl(ex.endpoint)} />
                      <div className="flex items-center gap-2 rounded-btn border border-brand-200 dark:border-brand-700 bg-white/60 dark:bg-brand-900/60 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-500">
                          Method
                        </p>
                        <p className="font-mono text-xs font-semibold text-brand-800 dark:text-brand-100">
                          POST
                        </p>
                      </div>

                      <p className="text-[11px] font-medium text-brand-500 dark:text-brand-400 pt-1">
                        Headers — tap “Add new header” for each:
                      </p>
                      <CopyRow
                        label="Authorization"
                        value={authValue}
                        hint={apiKey ? undefined : 'Generate a key above to fill this in'}
                      />
                      <CopyRow label="Content-Type" value="application/json" />

                      <p className="text-[11px] font-medium text-brand-500 dark:text-brand-400 pt-1">
                        Request Body — tap “JSON”, then “Add new field” for each:
                      </p>
                      {ex.fields.map((f) =>
                        f.isVariable ? (
                          <VariableRow key={f.key} label={f.key} variable={f.value} />
                        ) : (
                          <CopyRow key={f.key} label={`${f.key}  ·  ${f.valueType}`} value={f.value} />
                        ),
                      )}
                    </div>
                  </div>

                  {/* Phase 3 — finish */}
                  {ex.finishSteps && ex.finishSteps.length > 0 && (
                    <div>
                      <PhaseLabel>3 · Finish</PhaseLabel>
                      <ol className="space-y-1.5">
                        {ex.finishSteps.map((step, i) => (
                          <NumberedStep key={i} n={i + 1}>
                            {step}
                          </NumberedStep>
                        ))}
                      </ol>
                    </div>
                  )}
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
