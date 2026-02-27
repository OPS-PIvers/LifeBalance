import React, { useState } from 'react';
import { Key, Plus, Copy, Trash2, AlertTriangle, Clock, Shield } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HouseholdApiKey, ApiKeyPermissions } from '@/types/schema';
import {
  generateApiKey,
  revokeApiKey,
  deleteApiKey,
  getQuickAddEndpointUrl,
} from '@/services/apiKeyService';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

interface ApiKeyManagerProps {
  householdId: string;
  userId: string;
  apiKeys: HouseholdApiKey[];
  isAdmin: boolean;
}

const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({
  householdId,
  userId,
  apiKeys,
  isAdmin,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [permissions, setPermissions] = useState<ApiKeyPermissions>({
    habits: true,
    expenses: true,
    shoppingList: true,
    receiptScanning: false,  // Hidden until implemented
  });
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isAdmin) {
    return (
      <div className="text-center py-6 text-brand-500">
        <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>Only household admins can manage API keys.</p>
      </div>
    );
  }

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }

    setIsLoading(true);
    try {
      const result = await generateApiKey(
        householdId,
        newKeyName.trim(),
        permissions,
        userId
      );

      setNewlyCreatedKey(result.key);
      setNewKeyName('');
      setIsCreating(false);
      toast.success('API key created! Copy it now - it won\'t be shown again.');
    } catch (error) {
      console.error('Failed to create API key:', error);
      toast.error('Failed to create API key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleCopyEndpoint = async (endpoint: 'habit' | 'expense' | 'shopping') => {
    const url = getQuickAddEndpointUrl(endpoint);
    await navigator.clipboard.writeText(url);
    toast.success('Endpoint URL copied');
  };

  const handleRevokeKey = async (keyId: string, keyName: string) => {
    if (!confirm(`Revoke "${keyName}"? This will immediately stop all shortcuts using this key.`)) {
      return;
    }

    try {
      await revokeApiKey(householdId, keyId);
      toast.success('API key revoked');
    } catch (error) {
      console.error('Failed to revoke API key:', error);
      toast.error('Failed to revoke API key');
    }
  };

  const handleDeleteKey = async (keyId: string, keyName: string) => {
    if (!confirm(`Permanently delete "${keyName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteApiKey(householdId, keyId);
      toast.success('API key deleted');
    } catch (error) {
      console.error('Failed to delete API key:', error);
      toast.error('Failed to delete API key');
    }
  };

  const activeKeys = apiKeys.filter((k) => k.status === 'active');
  const revokedKeys = apiKeys.filter((k) => k.status === 'revoked');

  return (
    <div className="space-y-4">
      {/* Newly Created Key Warning */}
      {newlyCreatedKey && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-800">Copy your API key now!</p>
              <p className="text-sm text-amber-700">
                This is the only time you will see this key. Store it securely.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-3 py-2 rounded-lg border border-amber-200 text-sm font-mono break-all">
              {newlyCreatedKey}
            </code>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleCopyKey(newlyCreatedKey)}
              leftIcon={<Copy className="w-4 h-4" />}
            >
              Copy
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNewlyCreatedKey(null)}
            className="w-full"
          >
            I have copied the key
          </Button>
        </div>
      )}

      {/* Active Keys */}
      {activeKeys.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-brand-700">Active Keys</h4>
          {activeKeys.map((key) => (
            <div
              key={key.id}
              className="bg-white/80 backdrop-blur-sm ring-1 ring-black/5 rounded-xl p-4 space-y-3 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
                     <Key className="w-4 h-4 text-brand-600" />
                  </div>
                  <div>
                     <h5 className="font-bold text-slate-800 tracking-tight">{key.name}</h5>
                     <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {key.lastUsedAt
                                ? `Used ${formatDistanceToNow(new Date(key.lastUsedAt))} ago`
                                : 'Never used'}
                        </span>
                        <span>•</span>
                        <span>{key.usageCount} calls</span>
                     </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost-danger"
                    size="icon"
                    onClick={() => handleRevokeKey(key.id, key.name)}
                    title="Revoke key"
                    aria-label={`Revoke key ${key.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                 <code className="bg-slate-50 border border-slate-200/50 text-slate-600 px-2 py-1 rounded text-xs font-mono">{key.keyPrefix}...</code>
                 <div className="flex flex-wrap gap-1">
                    {key.permissions.habits && (
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md font-medium">
                        Habits
                    </span>
                    )}
                    {key.permissions.expenses && (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md font-medium">
                        Expenses
                    </span>
                    )}
                    {key.permissions.shoppingList && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-md font-medium">
                        Shopping
                    </span>
                    )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create New Key Form */}
      {isCreating ? (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 space-y-4">
          <h4 className="font-semibold text-brand-800">Create New API Key</h4>

          <div>
            <label className="block text-sm font-medium text-brand-700 mb-1">
              Key Name
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., iPhone Shortcut"
              className="w-full px-3 py-2 border border-brand-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-700 mb-2">
              Permissions
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissions.habits}
                  onChange={(e) =>
                    setPermissions({ ...permissions, habits: e.target.checked })
                  }
                  className="rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-brand-700">Habits (toggle habits)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissions.expenses}
                  onChange={(e) =>
                    setPermissions({ ...permissions, expenses: e.target.checked })
                  }
                  className="rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-brand-700">Expenses (add transactions)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissions.shoppingList}
                  onChange={(e) =>
                    setPermissions({ ...permissions, shoppingList: e.target.checked })
                  }
                  className="rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-brand-700">Shopping List (add items)</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleCreateKey}
              isLoading={isLoading}
              disabled={!newKeyName.trim()}
            >
              Create Key
            </Button>
            <Button variant="ghost" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setIsCreating(true)}
          leftIcon={<Plus className="w-4 h-4" />}
          className="w-full"
        >
          Generate New API Key
        </Button>
      )}

      {/* Endpoint URLs */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <h4 className="text-sm font-semibold text-gray-700">Endpoint URLs</h4>
        <p className="text-xs text-gray-500">
          Use these URLs in your iOS Shortcuts with your API key.
        </p>
        <div className="space-y-1">
          {(['habit', 'expense', 'shopping'] as const).map((endpoint) => (
            <button
              key={endpoint}
              onClick={() => handleCopyEndpoint(endpoint)}
              className="w-full flex items-center justify-between px-2 py-1.5 bg-white rounded border border-gray-100 hover:bg-gray-50 text-left"
            >
              <span className="text-xs font-mono text-gray-600 truncate">
                {getQuickAddEndpointUrl(endpoint)}
              </span>
              <Copy className="w-3 h-3 text-gray-400 flex-shrink-0 ml-2" />
            </button>
          ))}
        </div>
      </div>

      {/* Revoked Keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-2 pt-4 border-t border-slate-100">
          <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Revoked Keys</h4>
          {revokedKeys.map((key) => (
            <div
              key={key.id}
              className="bg-slate-50 border border-slate-100 rounded-xl p-3 opacity-50 grayscale hover:opacity-100 hover:grayscale-0 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center">
                     <Key className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                      <span className="font-semibold text-slate-600 line-through decoration-slate-400">
                        {key.name}
                      </span>
                      <div className="text-xs text-slate-400">Revoked</div>
                  </div>
                </div>
                <Button
                  variant="ghost-danger"
                  size="icon"
                  onClick={() => handleDeleteKey(key.id, key.name)}
                  title="Delete permanently"
                  aria-label={`Delete key ${key.name}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Security Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          API keys bypass normal authentication. Only share with trusted devices
          and revoke keys if your device is lost or compromised.
        </p>
      </div>
    </div>
  );
};

export default ApiKeyManager;
