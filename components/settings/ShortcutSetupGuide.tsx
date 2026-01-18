import React, { useState } from 'react';
import { ChevronDown, Smartphone, Mic, ShoppingCart, ExternalLink } from 'lucide-react';
import { getQuickAddEndpointUrl } from '@/services/apiKeyService';

interface ShortcutExample {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  steps: string[];
  jsonBody: string;
}

const ShortcutSetupGuide: React.FC = () => {
  const [expandedExample, setExpandedExample] = useState<string | null>(null);

  const examples: ShortcutExample[] = [
    {
      id: 'habit',
      title: 'Quick Habit Toggle',
      icon: <Smartphone className="w-5 h-5" />,
      description: 'One-tap habit completion from your Lock Screen',
      steps: [
        'Open the Shortcuts app on your iPhone',
        'Tap "+" to create a new shortcut',
        'Add action: "Get Contents of URL"',
        `Set URL to: ${getQuickAddEndpointUrl('habit')}`,
        'Set Method to: POST',
        'Add Header: Authorization with value: Bearer YOUR_API_KEY',
        'Add Header: Content-Type with value: application/json',
        'Set Request Body to JSON (see below)',
        'Add action: "Show Result" to see the response',
        'Tap the shortcut name and add to Lock Screen',
      ],
      jsonBody: JSON.stringify(
        {
          habitName: 'Morning Exercise',
          direction: 'up',
        },
        null,
        2
      ),
    },
    {
      id: 'expense-voice',
      title: 'Voice-Activated Expense',
      icon: <Mic className="w-5 h-5" />,
      description: '"Hey Siri, log expense" to quickly track spending',
      steps: [
        'Create a new shortcut named "Log Expense"',
        'Add action: "Ask for Input" (Number) - "How much did you spend?"',
        'Add action: "Set Variable" - name it "amount"',
        'Add action: "Ask for Input" (Text) - "Where?"',
        'Add action: "Set Variable" - name it "merchant"',
        'Add action: "Get Contents of URL"',
        `Set URL to: ${getQuickAddEndpointUrl('expense')}`,
        'Set Method to: POST',
        'Add Authorization header with your API key',
        'In JSON body, use variables: {"amount": [amount], "merchant": [merchant]}',
        'Add action: "Show Notification" with the result',
        'In shortcut settings, enable "Show in Siri"',
      ],
      jsonBody: JSON.stringify(
        {
          amount: 12.5,
          merchant: 'Coffee Shop',
          category: 'Dining',
        },
        null,
        2
      ),
    },
    {
      id: 'shopping',
      title: 'Voice Shopping List',
      icon: <ShoppingCart className="w-5 h-5" />,
      description: '"Hey Siri, add to shopping list" for quick grocery adds',
      steps: [
        'Create a new shortcut named "Add to Shopping List"',
        'Add action: "Ask for Input" (Text) - "What do you need?"',
        'Add action: "Set Variable" - name it "item"',
        'Add action: "Get Contents of URL"',
        `Set URL to: ${getQuickAddEndpointUrl('shopping')}`,
        'Set Method to: POST',
        'Add Authorization header with your API key',
        'In JSON body, use: {"item": [item]}',
        'Add action: "Show Notification" with the result',
        'In shortcut settings, enable "Show in Siri"',
      ],
      jsonBody: JSON.stringify(
        {
          item: 'Milk',
          quantity: 2,
          category: 'Dairy',
        },
        null,
        2
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <h4 className="font-semibold text-blue-800 mb-1">How It Works</h4>
        <p className="text-sm text-blue-700">
          iOS Shortcuts can send HTTP requests to your LifeBalance functions.
          Generate an API key above, then use these examples to create shortcuts
          for quick habit tracking and expense logging.
        </p>
      </div>

      {/* Quick Setup Tips */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-brand-700">Quick Setup Tips</h4>
        <ul className="text-sm text-brand-600 space-y-1 list-disc list-inside">
          <li>Copy your API key and endpoint URLs from above</li>
          <li>In Shortcuts, always use POST method</li>
          <li>Add <code>Bearer </code> before your API key in the Authorization header</li>
          <li>Set Content-Type to application/json</li>
          <li>iOS 18: Replace Lock Screen buttons with your shortcuts</li>
        </ul>
      </div>

      {/* Shortcut Examples */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-brand-700">Example Shortcuts</h4>

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
              <div className="p-3 bg-brand-50 border-t border-brand-100 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-brand-700 mb-2">Steps:</p>
                  <ol className="text-xs text-brand-600 space-y-1 list-decimal list-inside">
                    {example.steps.map((step, i) => (
                      <li key={i} className="leading-relaxed">
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>

                <div>
                  <p className="text-xs font-semibold text-brand-700 mb-1">
                    Example JSON Body:
                  </p>
                  <pre className="text-xs bg-white p-2 rounded border border-brand-100 overflow-x-auto">
                    <code>{example.jsonBody}</code>
                  </pre>
                </div>
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
              Replace the flashlight or camera button with your LifeBalance
              shortcut! Long-press your Lock Screen, tap Customize, then swap a
              button for your Quick Add shortcut.
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
