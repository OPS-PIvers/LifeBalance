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
      ],
      postActions: [
        'Tap Done in the top right',
        'IMPORTANT: When prompted, choose "Run Immediately" (not "Ask Before Running")',
        'Expenses auto-log as pending - review them in the Budget tab',
      ],
      isAutomation: true,
      automationNote: 'The Transaction trigger automatically provides Amount and Merchant as variables. The API will convert negative transaction amounts to positive expenses automatically. When adding body fields, tap the value field and select the matching variable from the list above the keyboard.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-5">
        <h4 className="font-bold text-indigo-900 mb-2 tracking-tight">How It Works</h4>
        <p className="text-sm text-indigo-700/90 leading-relaxed font-medium">
          iOS Shortcuts sends HTTP requests to your LifeBalance cloud functions.
          Generate an API key above, then follow these step-by-step guides.
        </p>
        <p className="text-xs text-indigo-600/80 mt-3 font-medium">
          Expenses added via Shortcuts are marked as pending for review in the Budget tab.
        </p>
      </div>

      {/* Shortcut Examples */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Shortcuts &amp; Automations</h4>

        {examples.map((example) => (
          <div
            key={example.id}
            className="bg-white border border-slate-200/60 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md hover:border-slate-300"
          >
            <button
              onClick={() =>
                setExpandedExample(
                  expandedExample === example.id ? null : example.id
                )
              }
              className="w-full flex items-center justify-between p-4 bg-white/50 hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${example.isRecommended ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-600'}`}>
                  {example.icon}
                </div>
                <div className="text-left">
                  <p className="font-bold text-slate-900 tracking-tight text-sm">{example.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">{example.description}</p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${
                  expandedExample === example.id ? 'rotate-180' : ''
                }`}
              />
            </button>

            {expandedExample === example.id && (
              <div className="p-5 bg-slate-50/30 border-t border-slate-100 space-y-6 animate-in slide-in-from-top-2 duration-200">
                {/* Pre-actions for voice shortcuts */}
                {example.preActions && (
                  <div>
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                      1. {example.isAutomation ? 'Create the automation:' : 'First, set up voice input:'}
                    </p>
                    <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside ml-2 font-medium">
                      {example.preActions.map((action, i) => (
                        <li key={i} className="pl-2 marker:text-slate-400">{action}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Automation note */}
                {example.automationNote && (
                  <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-3">
                    <p className="text-xs text-amber-800 font-medium leading-relaxed">{example.automationNote}</p>
                  </div>
                )}

                {/* Main setup */}
                <div>
                  <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                    {example.preActions ? '2.' : '1.'} Add <strong>Get Contents of URL</strong> action:
                  </p>
                  <ol className="text-sm text-slate-600 space-y-4 list-decimal list-inside ml-2 font-medium">
                    <li className="pl-2 marker:text-slate-400">
                      <strong className="text-slate-900">Paste the URL:</strong>
                      <button
                        onClick={() => copyToClipboard(getQuickAddEndpointUrl(example.endpoint), 'URL')}
                        className="mt-2 w-full flex items-center justify-between bg-white rounded-lg px-3 py-2 text-left hover:bg-slate-50 border border-slate-200/60 shadow-sm transition-all group"
                      >
                        <code className="text-xs text-indigo-600 font-mono break-all group-hover:text-indigo-700">
                          {getQuickAddEndpointUrl(example.endpoint)}
                        </code>
                        <Copy className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 ml-3 group-hover:text-slate-600" />
                      </button>
                    </li>

                    <li className="pl-2 marker:text-slate-400">
                      <strong className="text-slate-900">Tap &quot;Show More&quot;</strong> to reveal advanced options
                    </li>

                    <li className="pl-2 marker:text-slate-400">
                      <strong className="text-slate-900">Method:</strong> Tap &quot;GET&quot; → select &quot;POST&quot;
                    </li>

                    <li className="pl-2 marker:text-slate-400">
                      <strong className="text-slate-900">Add Headers</strong> (tap &quot;Add new header&quot; for each):
                      <div className="mt-3 space-y-3 ml-4">
                        <div className="bg-white rounded-xl p-3 border border-slate-200/60 shadow-sm">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px] block mb-1">Key</span>
                              <button
                                onClick={() => copyToClipboard('Authorization', 'Key')}
                                className="w-full text-left bg-slate-50 border border-slate-100 px-2 py-1 rounded font-mono text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                Authorization
                              </button>
                            </div>
                            <div>
                              <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px] block mb-1">Value</span>
                              <span className="block px-2 py-1 text-indigo-600 font-mono font-medium truncate">Bearer [API_KEY]</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2 font-medium">Replace [API_KEY] with your actual key from above</p>
                        </div>
                        <div className="bg-white rounded-xl p-3 border border-slate-200/60 shadow-sm">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px] block mb-1">Key</span>
                              <button
                                onClick={() => copyToClipboard('Content-Type', 'Key')}
                                className="w-full text-left bg-slate-50 border border-slate-100 px-2 py-1 rounded font-mono text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                Content-Type
                              </button>
                            </div>
                            <div>
                              <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px] block mb-1">Value</span>
                              <button
                                onClick={() => copyToClipboard('application/json', 'Value')}
                                className="w-full text-left bg-slate-50 border border-slate-100 px-2 py-1 rounded font-mono text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                application/json
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>

                    <li className="pl-2 marker:text-slate-400">
                      <strong className="text-slate-900">Request Body:</strong> Tap &quot;JSON&quot; → tap &quot;Add new field&quot; for each field below:
                      <div className="mt-3 space-y-3 ml-4">
                        {example.fields.map((field, i) => (
                          <div key={i} className="bg-white rounded-xl p-3 border border-slate-200/60 shadow-sm">
                            <div className="text-xs space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px]">Key</span>
                                <button
                                  onClick={() => copyToClipboard(field.key, 'Key')}
                                  className="bg-slate-50 border border-slate-100 px-2 py-1 rounded font-mono text-slate-700 hover:bg-slate-100 transition-colors min-w-[100px] text-left"
                                >
                                  {field.key}
                                </button>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px]">Type</span>
                                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold text-[10px] uppercase">
                                  {field.valueType}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 uppercase tracking-wider font-bold text-[10px]">Value</span>
                                {field.isVariable ? (
                                  <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded text-[10px] font-medium border border-purple-100">
                                    Tap value field → &quot;Select Variable&quot; → choose <strong>{field.value}</strong>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => copyToClipboard(field.value, 'Value')}
                                    className="bg-slate-50 border border-slate-100 px-2 py-1 rounded font-mono text-slate-700 hover:bg-slate-100 transition-colors min-w-[100px] text-left"
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
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                      {example.preActions ? '3.' : '2.'} Finish setup:
                    </p>
                    <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside ml-2 font-medium">
                      {example.postActions.map((action, i) => (
                        <li key={i} className="pl-2 marker:text-slate-400">{action}</li>
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
      <div className="bg-gradient-to-r from-purple-50/50 to-indigo-50/50 border border-purple-100 rounded-2xl p-4 ring-1 ring-black/5">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-white rounded-lg shadow-sm text-purple-600 border border-purple-100">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-purple-900 text-sm tracking-tight">iOS Lock Screen Shortcuts</h4>
            <p className="text-xs text-purple-700 mt-1 font-medium leading-relaxed">
              Replace the flashlight or camera button with your shortcut!
              Long-press Lock Screen → Customize → tap a button to swap it.
            </p>
            <p className="text-[10px] text-purple-500 mt-2 font-medium bg-white/50 px-2 py-1 rounded inline-block">
              💡 Tip: With iOS 18+ & Siri Intelligence, just say &quot;Add to LifeBalance&quot; naturally.
            </p>
          </div>
        </div>
      </div>

      {/* Documentation Link */}
      <a
        href="https://support.apple.com/guide/shortcuts/welcome/ios"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-800 py-4 transition-colors uppercase tracking-wider"
      >
        <ExternalLink className="w-3 h-3" />
        Apple Shortcuts Documentation
      </a>
    </div>
  );
};

export default ShortcutSetupGuide;
