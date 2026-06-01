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
        'Add an "If" action → set it to: Amount → is greater than → 0 (this skips Apple Pay\'s $0 holding charges)',
        'You\'ll add the "Get Contents of URL" action (next step) INSIDE the If block, above "Otherwise"',
      ],
      postActions: [
        'Tap Done in the top right',
        'IMPORTANT: When prompted, choose "Run Immediately" (not "Ask Before Running")',
        'Expenses auto-log as pending - review them in the Budget tab',
      ],
      isAutomation: true,
      automationNote: 'The Transaction trigger automatically provides Amount and Merchant as variables. IMPORTANT: Apple Pay fires this trigger on the authorization event, which often arrives as a $0 pre-authorization hold (the real amount settles later on the bank side and does not re-fire the trigger). The "If Amount > 0" step above filters those out so they don\'t clutter your review queue. As a safety net, the server also automatically skips any $0 that slips through. The API accepts positive or negative amounts and handles common formats automatically: 50, -50, "$50.00", "-$50.00", "50,00", "1.234,56", and accounting notation "(50.00)". Both signs work correctly regardless of your iOS version or locale. When adding body fields, tap the value field and select the matching variable from the list above the keyboard.',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <h4 className="font-semibold text-blue-800 mb-1">How It Works</h4>
        <p className="text-sm text-blue-700">
          iOS Shortcuts sends HTTP requests to your LifeBalance cloud functions.
          Generate an API key above, then follow these step-by-step guides.
        </p>
        <p className="text-xs text-blue-600 mt-2">
          Expenses added via Shortcuts are marked as pending for review in the Budget tab.
        </p>
      </div>

      {/* Shortcut Examples */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-brand-700">Shortcuts &amp; Automations</h4>

        {examples.map((example) => (
          <div
            key={example.id}
            className="border border-brand-100 rounded-xl overflow-hidden"
          >
            <button
              onClick={() =>
                setExpandedExample(
                  expandedExample === example.id ? null : example.id
                )
              }
              className="w-full flex items-center justify-between p-3 bg-white hover:bg-brand-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="text-brand-600">{example.icon}</div>
                <div className="text-left">
                  <p className="font-semibold text-brand-800">{example.title}</p>
                  <p className="text-xs text-brand-500">{example.description}</p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-400 transition-transform ${
                  expandedExample === example.id ? 'rotate-180' : ''
                }`}
              />
            </button>

            {expandedExample === example.id && (
              <div className="p-3 bg-brand-50 border-t border-brand-100 space-y-4">
                {/* Pre-actions for voice shortcuts */}
                {example.preActions && (
                  <div>
                    <p className="text-xs font-semibold text-brand-700 mb-2">
                      1. {example.isAutomation ? 'Create the automation:' : 'First, set up voice input:'}
                    </p>
                    <ol className="text-xs text-brand-600 space-y-1 list-decimal list-inside ml-2">
                      {example.preActions.map((action, i) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Automation note */}
                {example.automationNote && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <p className="text-xs text-amber-800">{example.automationNote}</p>
                  </div>
                )}

                {/* Main setup */}
                <div>
                  <p className="text-xs font-semibold text-brand-700 mb-2">
                    {example.preActions ? '2.' : '1.'} Add <strong>Get Contents of URL</strong> action:
                  </p>
                  <ol className="text-xs text-brand-600 space-y-3 list-decimal list-inside ml-2">
                    <li>
                      <strong>Paste the URL:</strong>
                      <button
                        onClick={() => copyToClipboard(getQuickAddEndpointUrl(example.endpoint), 'URL')}
                        className="mt-1 w-full flex items-center justify-between bg-gray-50 rounded px-2 py-1.5 text-left hover:bg-gray-100 border"
                      >
                        <code className="text-xs text-blue-600 break-all">
                          {getQuickAddEndpointUrl(example.endpoint)}
                        </code>
                        <Copy className="w-3 h-3 text-gray-400 flex-shrink-0 ml-2" />
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
                        <div className="bg-gray-50 rounded p-2 border">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-500">Key:</span>
                              <button
                                onClick={() => copyToClipboard('Authorization', 'Key')}
                                className="ml-1 bg-white border px-2 py-0.5 rounded font-mono hover:bg-gray-100"
                              >
                                Authorization
                              </button>
                            </div>
                            <div>
                              <span className="text-gray-500">Value:</span>
                              <span className="ml-1 text-blue-600 font-mono">Bearer [API_KEY]</span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Replace [API_KEY] with your actual key from above</p>
                        </div>
                        <div className="bg-gray-50 rounded p-2 border">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-500">Key:</span>
                              <button
                                onClick={() => copyToClipboard('Content-Type', 'Key')}
                                className="ml-1 bg-white border px-2 py-0.5 rounded font-mono hover:bg-gray-100"
                              >
                                Content-Type
                              </button>
                            </div>
                            <div>
                              <span className="text-gray-500">Value:</span>
                              <button
                                onClick={() => copyToClipboard('application/json', 'Value')}
                                className="ml-1 bg-white border px-2 py-0.5 rounded font-mono hover:bg-gray-100"
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
                          <div key={i} className="bg-gray-50 rounded p-2 border">
                            <div className="text-xs space-y-1">
                              <div>
                                <span className="text-gray-500">Key:</span>
                                <button
                                  onClick={() => copyToClipboard(field.key, 'Key')}
                                  className="ml-1 bg-white border px-2 py-0.5 rounded font-mono hover:bg-gray-100"
                                >
                                  {field.key}
                                </button>
                              </div>
                              <div>
                                <span className="text-gray-500">Type:</span>
                                <span className="ml-1 bg-gray-200 px-2 py-0.5 rounded font-medium">
                                  {field.valueType}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Value:</span>
                                {field.isVariable ? (
                                  <span className="ml-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs">
                                    Tap value field → &quot;Select Variable&quot; → choose <strong>{field.value}</strong> (blue pill)
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => copyToClipboard(field.value, 'Value')}
                                    className="ml-1 bg-white border px-2 py-0.5 rounded font-mono hover:bg-gray-100"
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
                    <p className="text-xs font-semibold text-brand-700 mb-2">
                      {example.preActions ? '3.' : '2.'} Finish setup:
                    </p>
                    <ol className="text-xs text-brand-600 space-y-1 list-decimal list-inside ml-2">
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
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Smartphone className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-purple-800">iOS Lock Screen Shortcuts</h4>
            <p className="text-sm text-purple-700 mt-1">
              Replace the flashlight or camera button with your shortcut!
              Long-press Lock Screen → Customize → tap a button to swap it.
            </p>
            <p className="text-xs text-purple-600 mt-2">
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
        className="flex items-center justify-center gap-2 text-sm text-brand-600 hover:text-brand-800 py-2"
      >
        <ExternalLink className="w-4 h-4" />
        Apple Shortcuts Documentation
      </a>
    </div>
  );
};

export default ShortcutSetupGuide;
