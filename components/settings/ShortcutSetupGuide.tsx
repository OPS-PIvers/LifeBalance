import React, { useState } from 'react';
import { ChevronDown, Smartphone, Mic, ShoppingCart, ExternalLink, Copy, CreditCard } from 'lucide-react';
import { getQuickAddEndpointUrl } from '@/services/apiKeyService';
import toast from 'react-hot-toast';

interface ShortcutExample {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  endpoint: 'habit' | 'expense' | 'shopping' | 'naturalLanguage';
  fields: { key: string; value: string; valueType: 'Text' | 'Number'; isVariable?: boolean }[];
  preActions?: string[];
  postActions?: string[];
  isAutomation?: boolean;  // True for automations that provide variables automatically
  automationNote?: string; // Extra note for automations
  isRecommended?: boolean; // True to highlight as recommended approach
}

const ShortcutSetupGuide: React.FC = () => {
  const [expandedExample, setExpandedExample] = useState<string | null>(null);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const examples: ShortcutExample[] = [
    {
      id: 'natural-language',
      title: 'Natural Language Quick Add',
      icon: <Mic className="w-5 h-5" />,
      description: '🌟 RECOMMENDED: Speak naturally to add shopping items, todos, or expenses - no counting needed!',
      endpoint: 'naturalLanguage',
      isRecommended: true,
      fields: [
        { key: 'text', value: 'Text Input', valueType: 'Text', isVariable: true },
      ],
      preActions: [
        'Add "Ask for Input" → tap Prompt field → type "What would you like to add?"',
        'Tap "Text" (keep as Text) → toggle ON "Allow Speech Input"',
        'Add "Set Variable" → tap "Variable Name" → type "Text Input"',
      ],
      postActions: [
        'Add "Show Notification" → notification will confirm items queued',
        'Open LifeBalance app to see processed items',
        'Tap shortcut name at top → rename to "Quick Add to LifeBalance"',
        'Tap ⓘ icon → toggle ON "Show in Share Sheet" and "Show in App"',
        'Say: "Hey Siri, add milk, eggs, and bread to shopping list" or "Remind me to fix the sink and call dentist"',
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
      postActions: [
        'Add "Show Notification" → notification text will auto-populate from API response',
        'Tap shortcut name at top → rename to "Log Exercise"',
        'Tap ⋮ menu → choose "Add to Home Screen" or "Add to Lock Screen"',
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
      preActions: [
        'Add "Ask for Input" → tap Prompt field → type "How much did you spend?"',
        'Tap "Text" → change to "Number" → tap Done',
        'Add "Set Variable" → tap "Variable Name" → type "Amount"',
        'Add "Ask for Input" again → tap Prompt field → type "Where did you spend it?"',
        'Add "Set Variable" → tap "Variable Name" → type "Merchant"',
      ],
      postActions: [
        'Add "Show Notification" → notification will confirm expense logged',
        'Tap shortcut name at top → rename to "Log Expense"',
        'Tap ⓘ icon → toggle ON "Show in Share Sheet" and "Show in App"',
      ],
    },
    {
      id: 'shopping',
      title: 'Voice Shopping List',
      icon: <ShoppingCart className="w-5 h-5" />,
      description: '"Hey Siri, add to shopping list" for quick grocery adds',
      endpoint: 'shopping',
      fields: [
        { key: 'item', value: 'Item', valueType: 'Text', isVariable: true },
      ],
      preActions: [
        'Add "Ask for Input" → tap Prompt field → type "What do you need?"',
        'Add "Set Variable" → tap "Variable Name" → type "Item"',
      ],
      postActions: [
        'Add "Show Notification" → notification will confirm item added',
        'Tap shortcut name at top → rename to "Add to Shopping List"',
        'Tap ⓘ icon → toggle ON "Show in Share Sheet" and "Show in App"',
      ],
    },
    {
      id: 'wallet-auto',
      title: 'Apple Wallet Auto-Log',
      icon: <CreditCard className="w-5 h-5" />,
      description: 'Automatically log expenses when you pay with Apple Pay',
      endpoint: 'expense',
      fields: [
        { key: 'amount', value: 'Amount', valueType: 'Number', isVariable: true },
        { key: 'merchant', value: 'Merchant', valueType: 'Text', isVariable: true },
      ],
      preActions: [
        'Open Shortcuts app → tap Automation tab (bottom center)',
        'Tap + in the top right corner',
        'Scroll down and tap Transaction',
        'Choose your Apple Pay card(s), then tap Next',
        'Already set this up before? DELETE any "If Amount > 0" filter you added — $0 pre-auths now become an "awaiting amount" item you complete in the app, so every transaction should be sent through',
      ],
      postActions: [
        'Tap Done in the top right',
        'IMPORTANT: When prompted, choose "Run Immediately" (not "Ask Before Running")',
        'Expenses auto-log as pending - review them in the Budget tab',
      ],
      isAutomation: true,
      automationNote: 'The Transaction trigger automatically provides Amount and Merchant as variables. Apple Pay fires this trigger on the authorization event, which often arrives as a $0 pre-authorization hold (the real amount settles later on the bank side and does not re-fire the trigger). LifeBalance now captures those: a $0 charge with a merchant becomes an "awaiting amount" item — next time you open the app you\'ll be prompted to enter the real total (or fill it in later from the Action Queue). So do NOT add an "If Amount > 0" filter; let every transaction through. The API accepts positive or negative amounts and handles common formats automatically: 50, -50, "$50.00", "-$50.00", "50,00", "1.234,56", and accounting notation "(50.00)". Both signs work correctly regardless of your iOS version or locale. When adding body fields, tap the value field and select the matching variable from the list above the keyboard.',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-accent-50 border border-accent-200 rounded-btn p-3 dark:bg-accent-500/10 dark:border-accent-500/30">
        <h4 className="font-semibold text-accent-800 dark:text-accent-200 mb-1">How It Works</h4>
        <p className="text-sm text-accent-700 dark:text-accent-300">
          iOS Shortcuts sends HTTP requests to your LifeBalance cloud functions.
          Generate an API key above, then follow these step-by-step guides.
        </p>
        <p className="text-xs text-accent-600 dark:text-accent-400 mt-2">
          Expenses added via Shortcuts are marked as pending for review in the Budget tab.
        </p>
      </div>

      {/* Shortcut Examples */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Shortcuts &amp; Automations</h4>

        {examples.map((example) => (
          <div
            key={example.id}
            className="surface-section overflow-hidden"
          >
            <button
              onClick={() =>
                setExpandedExample(
                  expandedExample === example.id ? null : example.id
                )
              }
              className="w-full flex items-center justify-between p-3 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
            >
              <div className="flex items-center gap-3">
                <div className="text-accent-600 dark:text-accent-400">{example.icon}</div>
                <div className="text-left">
                  <p className="font-semibold text-brand-900 dark:text-brand-100">{example.title}</p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">{example.description}</p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-brand-400 dark:text-brand-500 transition-transform duration-(--duration-base) ease-spring ${
                  expandedExample === example.id ? 'rotate-180 text-accent-600 dark:text-accent-400' : ''
                }`}
              />
            </button>

            {expandedExample === example.id && (
              <div className="p-3 bg-brand-50 dark:bg-brand-900/40 border-t border-brand-200 dark:border-brand-700 space-y-4">
                {/* Pre-actions for voice shortcuts */}
                {example.preActions && (
                  <div>
                    <p className="text-xs font-semibold text-brand-700 dark:text-brand-200 mb-2">
                      1. {example.isAutomation ? 'Create the automation:' : 'First, set up voice input:'}
                    </p>
                    <ol className="text-xs text-brand-600 dark:text-brand-300 space-y-1 list-decimal list-inside ml-2">
                      {example.preActions.map((action, i) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Automation note */}
                {example.automationNote && (
                  <div className="bg-warm-50 border border-warm-200 rounded-btn p-2 dark:bg-warm-500/10 dark:border-warm-500/30">
                    <p className="text-xs text-warm-800 dark:text-warm-300">{example.automationNote}</p>
                  </div>
                )}

                {/* Main setup */}
                <div>
                  <p className="text-xs font-semibold text-brand-700 dark:text-brand-200 mb-2">
                    {example.preActions ? '2.' : '1.'} Add <strong>Get Contents of URL</strong> action:
                  </p>
                  <ol className="text-xs text-brand-600 dark:text-brand-300 space-y-3 list-decimal list-inside ml-2">
                    <li>
                      <strong>Paste the URL:</strong>
                      <button
                        onClick={() => copyToClipboard(getQuickAddEndpointUrl(example.endpoint), 'URL')}
                        className="mt-1 w-full flex items-center justify-between bg-white dark:bg-brand-900 rounded-sm px-2 py-1.5 text-left hover:bg-brand-50 dark:hover:bg-brand-800 border border-brand-200 dark:border-brand-700 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
                      >
                        <code className="text-xs text-accent-600 dark:text-accent-300 break-all">
                          {getQuickAddEndpointUrl(example.endpoint)}
                        </code>
                        <Copy className="w-3 h-3 text-brand-400 dark:text-brand-500 shrink-0 ml-2" />
                      </button>
                    </li>

                    <li>
                      <strong>Tap &quot;Show More&quot;</strong> to reveal advanced options
                    </li>

                    <li>
                      <strong>Method:</strong> Tap &quot;GET&quot; → select &quot;POST&quot;
                    </li>

                    <li>
                      <strong>Add Headers</strong> (tap &quot;Add new header&quot; for each):
                      <div className="mt-2 space-y-2 ml-4">
                        <div className="bg-white dark:bg-brand-900 rounded-sm p-2 border border-brand-200 dark:border-brand-700">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-brand-500 dark:text-brand-400">Key:</span>
                              <button
                                onClick={() => copyToClipboard('Authorization', 'Key')}
                                className="ml-1 bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 px-2 py-0.5 rounded-sm font-mono text-brand-700 dark:text-brand-200 hover:bg-brand-200 dark:hover:bg-brand-600 transition-colors"
                              >
                                Authorization
                              </button>
                            </div>
                            <div>
                              <span className="text-brand-500 dark:text-brand-400">Value:</span>
                              <span className="ml-1 text-accent-600 dark:text-accent-300 font-mono">Bearer [API_KEY]</span>
                            </div>
                          </div>
                          <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">Replace [API_KEY] with your actual key from above</p>
                        </div>
                        <div className="bg-white dark:bg-brand-900 rounded-sm p-2 border border-brand-200 dark:border-brand-700">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-brand-500 dark:text-brand-400">Key:</span>
                              <button
                                onClick={() => copyToClipboard('Content-Type', 'Key')}
                                className="ml-1 bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 px-2 py-0.5 rounded-sm font-mono text-brand-700 dark:text-brand-200 hover:bg-brand-200 dark:hover:bg-brand-600 transition-colors"
                              >
                                Content-Type
                              </button>
                            </div>
                            <div>
                              <span className="text-brand-500 dark:text-brand-400">Value:</span>
                              <button
                                onClick={() => copyToClipboard('application/json', 'Value')}
                                className="ml-1 bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 px-2 py-0.5 rounded-sm font-mono text-brand-700 dark:text-brand-200 hover:bg-brand-200 dark:hover:bg-brand-600 transition-colors"
                              >
                                application/json
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>

                    <li>
                      <strong>Request Body:</strong> Tap &quot;JSON&quot; → tap &quot;Add new field&quot; for each field below:
                      <div className="mt-2 space-y-2 ml-4">
                        {example.fields.map((field, i) => (
                          <div key={i} className="bg-white dark:bg-brand-900 rounded-sm p-2 border border-brand-200 dark:border-brand-700">
                            <div className="text-xs space-y-1">
                              <div>
                                <span className="text-brand-500 dark:text-brand-400">Key:</span>
                                <button
                                  onClick={() => copyToClipboard(field.key, 'Key')}
                                  className="ml-1 bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 px-2 py-0.5 rounded-sm font-mono text-brand-700 dark:text-brand-200 hover:bg-brand-200 dark:hover:bg-brand-600 transition-colors"
                                >
                                  {field.key}
                                </button>
                              </div>
                              <div>
                                <span className="text-brand-500 dark:text-brand-400">Type:</span>
                                <span className="ml-1 bg-brand-200 dark:bg-brand-700 text-brand-700 dark:text-brand-200 px-2 py-0.5 rounded-sm font-medium">
                                  {field.valueType}
                                </span>
                              </div>
                              <div>
                                <span className="text-brand-500 dark:text-brand-400">Value:</span>
                                {field.isVariable ? (
                                  <span className="ml-1 bg-accent-50 text-accent-700 border border-accent-200 px-2 py-0.5 rounded-sm text-xs dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30">
                                    Tap value field → &quot;Select Variable&quot; → choose <strong>{field.value}</strong>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => copyToClipboard(field.value, 'Value')}
                                    className="ml-1 bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 px-2 py-0.5 rounded-sm font-mono text-brand-700 dark:text-brand-200 hover:bg-brand-200 dark:hover:bg-brand-600 transition-colors"
                                  >
                                    {field.value}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </li>
                  </ol>
                </div>

                {/* Post actions */}
                {example.postActions && (
                  <div>
                    <p className="text-xs font-semibold text-brand-700 dark:text-brand-200 mb-2">
                      {example.preActions ? '3.' : '2.'} Finish setup:
                    </p>
                    <ol className="text-xs text-brand-600 dark:text-brand-300 space-y-1 list-decimal list-inside ml-2">
                      {example.postActions.map((action, i) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* iOS Lock Screen Feature */}
      <div className="bg-warm-50 border border-warm-200 rounded-btn p-3 dark:bg-warm-500/10 dark:border-warm-500/30">
        <div className="flex items-start gap-2">
          <Smartphone className="w-5 h-5 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-warm-800 dark:text-warm-200">iOS Lock Screen Shortcuts</h4>
            <p className="text-sm text-warm-700 dark:text-warm-300 mt-1">
              Replace the flashlight or camera button with your shortcut!
              Long-press Lock Screen → Customize → tap a button to swap it.
            </p>
            <p className="text-xs text-warm-600 dark:text-warm-400 mt-2">
              With iOS 26&apos;s Gemini-powered Siri, voice commands are more accurate—try saying &quot;Add milk and eggs to shopping list&quot; for multi-item adds.
            </p>
          </div>
        </div>
      </div>

      {/* Documentation Link */}
      <a
        href="https://support.apple.com/guide/shortcuts/welcome/ios"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-sm text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 py-2 transition-colors"
      >
        <ExternalLink className="w-4 h-4" />
        Apple Shortcuts Documentation
      </a>
    </div>
  );
};

export default ShortcutSetupGuide;
