import React, { useState } from 'react';
import { ChevronDown, Smartphone, Mic, ShoppingCart, ExternalLink, Copy } from 'lucide-react';
import { getQuickAddEndpointUrl } from '@/services/apiKeyService';
import toast from 'react-hot-toast';

interface ShortcutExample {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  endpoint: 'habit' | 'expense' | 'shopping';
  fields: { key: string; value: string; type: 'text' | 'number' | 'variable' }[];
  preActions?: string[];
  postActions?: string[];
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
      id: 'habit',
      title: 'Quick Habit Toggle',
      icon: <Smartphone className="w-5 h-5" />,
      description: 'One-tap habit completion from your Lock Screen',
      endpoint: 'habit',
      fields: [
        { key: 'habitName', value: 'Morning Exercise', type: 'text' },
        { key: 'direction', value: 'up', type: 'text' },
      ],
      postActions: [
        'Search "Show Result" and add it',
        'Tap the shortcut name at top, rename it (e.g., "Log Exercise")',
        'Tap "Add to Home Screen" or "Add to Lock Screen" (iOS 18)',
      ],
    },
    {
      id: 'expense-voice',
      title: 'Voice-Activated Expense',
      icon: <Mic className="w-5 h-5" />,
      description: '"Hey Siri, log expense" to quickly track spending',
      endpoint: 'expense',
      fields: [
        { key: 'amount', value: 'Amount', type: 'variable' },
        { key: 'merchant', value: 'Merchant', type: 'variable' },
        { key: 'category', value: 'Dining', type: 'text' },
      ],
      preActions: [
        'Search "Ask for Input" - set Type to Number, Prompt to "How much?"',
        'Search "Set Variable" - name it "Amount"',
        'Search "Ask for Input" again - set Type to Text, Prompt to "Where?"',
        'Search "Set Variable" - name it "Merchant"',
      ],
      postActions: [
        'Search "Show Notification" and add it',
        'Tap shortcut name, rename to "Log Expense"',
        'In shortcut settings (i icon), enable "Show in Siri Suggestions"',
      ],
    },
    {
      id: 'shopping',
      title: 'Voice Shopping List',
      icon: <ShoppingCart className="w-5 h-5" />,
      description: '"Hey Siri, add to shopping list" for quick grocery adds',
      endpoint: 'shopping',
      fields: [
        { key: 'item', value: 'Item', type: 'variable' },
      ],
      preActions: [
        'Search "Ask for Input" - set Type to Text, Prompt to "What do you need?"',
        'Search "Set Variable" - name it "Item"',
      ],
      postActions: [
        'Search "Show Notification" and add it',
        'Tap shortcut name, rename to "Add to Shopping List"',
        'In shortcut settings (i icon), enable "Show in Siri Suggestions"',
      ],
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
      </div>

      {/* Shortcut Examples */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-brand-700">Step-by-Step Guides</h4>

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
                      1. First, set up voice input:
                    </p>
                    <ol className="text-xs text-brand-600 space-y-1 list-decimal list-inside ml-2">
                      {example.preActions.map((action, i) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Main setup */}
                <div>
                  <p className="text-xs font-semibold text-brand-700 mb-2">
                    {example.preActions ? '2.' : '1.'} Add <strong>Get Contents of URL</strong>:
                  </p>
                  <div className="bg-white rounded-lg border border-brand-200 p-3 space-y-3">
                    {/* URL */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">URL (tap to copy):</p>
                      <button
                        onClick={() => copyToClipboard(getQuickAddEndpointUrl(example.endpoint), 'URL')}
                        className="w-full flex items-center justify-between bg-gray-50 rounded px-2 py-1.5 text-left hover:bg-gray-100"
                      >
                        <code className="text-xs text-blue-600 break-all">
                          {getQuickAddEndpointUrl(example.endpoint)}
                        </code>
                        <Copy className="w-3 h-3 text-gray-400 flex-shrink-0 ml-2" />
                      </button>
                    </div>

                    {/* Method */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Method:</p>
                      <p className="text-xs font-mono bg-gray-50 rounded px-2 py-1">POST</p>
                    </div>

                    {/* Headers */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Headers (tap + Add new header):</p>
                      <div className="space-y-1">
                        <div className="flex gap-2 text-xs">
                          <span className="bg-gray-100 px-2 py-1 rounded font-medium">Authorization</span>
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded flex-1 font-mono">
                            Bearer YOUR_API_KEY
                          </span>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <span className="bg-gray-100 px-2 py-1 rounded font-medium">Content-Type</span>
                          <button
                            onClick={() => copyToClipboard('application/json', 'Content-Type')}
                            className="bg-blue-50 text-blue-700 px-2 py-1 rounded flex-1 font-mono text-left hover:bg-blue-100"
                          >
                            application/json
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Request Body */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Request Body: tap JSON, then + Add new field for each:</p>
                      <div className="space-y-1">
                        {example.fields.map((field, i) => (
                          <div key={i} className="flex gap-2 text-xs items-center">
                            <span className="bg-gray-100 px-2 py-1 rounded font-medium min-w-[80px]">
                              {field.key}
                            </span>
                            {field.type === 'variable' ? (
                              <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded flex-1">
                                [Select Variable: {field.value}]
                              </span>
                            ) : field.type === 'number' ? (
                              <span className="bg-green-50 text-green-700 px-2 py-1 rounded flex-1 font-mono">
                                {field.value}
                              </span>
                            ) : (
                              <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded flex-1 font-mono">
                                {field.value}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
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

      {/* iOS 18 Lock Screen Feature */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Smartphone className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-purple-800">iOS 18 Lock Screen</h4>
            <p className="text-sm text-purple-700 mt-1">
              Replace the flashlight or camera button with your shortcut!
              Long-press Lock Screen → Customize → tap a button to swap it.
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
