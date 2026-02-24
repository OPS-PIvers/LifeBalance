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
      <div className="text-center py-8 text-slate-500 bg-slate-50/50 rounded-2xl border border-slate-100 border-dashed">
        <Shield className="w-8 h-8 mx-auto mb-2 opacity-50 text-slate-400" />
        <p className="font-medium">Only household admins can manage API keys.</p>
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
    <div className="space-y-6">
      {/* Newly Created Key Warning */}
      {newlyCreatedKey && (
        <div className="bg-amber-50/50 border border-amber-200/60 rounded-2xl p-5 space-y-4 ring-1 ring-black/5 animate-in slide-in-from-top-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            </div>
            <div>
              <p className="font-bold text-amber-900 tracking-tight">Copy your API key now!</p>
              <p className="text-sm text-amber-700 leading-relaxed mt-1">
                This is the only time you will see this key. Store it securely.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white px-4 py-3 rounded-xl border border-amber-200/60 text-sm font-mono break-all text-slate-700 shadow-sm">
              {newlyCreatedKey}
            </code>
            <Button
              variant="primary"
              size="md"
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
            className="w-full text-amber-700 hover:text-amber-900 hover:bg-amber-100/50"
          >
            I have copied the key
          </Button>
        </div>
      )}

      {/* Active Keys */}
      {activeKeys.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Keys</h4>
          {activeKeys.map((key) => (
            <div
              key={key.id}
              className="bg-white border border-slate-200/60 rounded-xl p-4 space-y-3 shadow-sm transition-all hover:shadow-md hover:border-slate-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-50 rounded-lg text-slate-500">
                    <Key className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-slate-900 tracking-tight">{key.name}</span>
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
              <div className="flex items-center gap-4 text-xs text-slate-500 font-medium">
                <code className="bg-slate-50 px-2 py-0.5 rounded border border-slate-100 font-mono text-slate-600">{key.keyPrefix}...</code>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-400" />
                  {key.lastUsedAt
                    ? `Used ${formatDistanceToNow(new Date(key.lastUsedAt))} ago`
                    : 'Never used'}
                </span>
                <span className="bg-slate-50 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider">{key.usageCount} calls</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {key.permissions.habits && (
                  <span className="text-[10px] bg-green-50 text-green-700 border border-green-100 px-2 py-1 rounded-full font-semibold uppercase tracking-wider">
                    Habits
                  </span>
                )}
                {key.permissions.expenses && (
                  <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-full font-semibold uppercase tracking-wider">
                    Expenses
                  </span>
                )}
                {key.permissions.shoppingList && (
                  <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-2 py-1 rounded-full font-semibold uppercase tracking-wider">
                    Shopping
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create New Key Form */}
      {isCreating ? (
        <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl p-5 space-y-5 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center gap-3 mb-2">
             <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                <Plus className="w-5 h-5" />
             </div>
             <h4 className="font-bold text-slate-900 tracking-tight">Create New API Key</h4>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Key Name
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., iPhone Shortcut"
              className="w-full px-4 py-3 bg-white border border-slate-200/60 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 transition-all font-medium text-slate-900 placeholder:text-slate-400 shadow-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Permissions
            </label>
            <div className="space-y-3 bg-white rounded-xl border border-slate-200/60 p-4 shadow-sm">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={permissions.habits}
                  onChange={(e) =>
                    setPermissions({ ...permissions, habits: e.target.checked })
                  }
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-colors cursor-pointer"
                />
                <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">Habits (toggle habits)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={permissions.expenses}
                  onChange={(e) =>
                    setPermissions({ ...permissions, expenses: e.target.checked })
                  }
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-colors cursor-pointer"
                />
                <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">Expenses (add transactions)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={permissions.shoppingList}
                  onChange={(e) =>
                    setPermissions({ ...permissions, shoppingList: e.target.checked })
                  }
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-colors cursor-pointer"
                />
                <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">Shopping List (add items)</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="primary"
              onClick={handleCreateKey}
              isLoading={isLoading}
              disabled={!newKeyName.trim()}
              className="flex-1"
            >
              Create Key
            </Button>
            <Button variant="ghost" onClick={() => setIsCreating(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setIsCreating(true)}
          leftIcon={<Plus className="w-4 h-4" />}
          className="w-full py-4 border-dashed border-slate-300 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/50"
        >
          Generate New API Key
        </Button>
      )}

      {/* Endpoint URLs */}
      <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl p-5 space-y-3">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Endpoint URLs</h4>
        <p className="text-xs text-slate-500 font-medium leading-relaxed mb-2">
          Use these URLs in your iOS Shortcuts with your API key.
        </p>
        <div className="space-y-2">
          {(['habit', 'expense', 'shopping'] as const).map((endpoint) => (
            <button
              key={endpoint}
              onClick={() => handleCopyEndpoint(endpoint)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-white rounded-xl border border-slate-200/60 hover:bg-slate-50 hover:border-slate-300 text-left transition-all shadow-sm group"
            >
              <span className="text-xs font-mono text-slate-600 truncate group-hover:text-slate-900 transition-colors">
                {getQuickAddEndpointUrl(endpoint)}
              </span>
              <Copy className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 ml-2 group-hover:text-slate-600" />
            </button>
          ))}
        </div>
      </div>

      {/* Revoked Keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Revoked Keys</h4>
          {revokedKeys.map((key) => (
            <div
              key={key.id}
              className="bg-slate-50 border border-slate-100 rounded-xl p-3 opacity-60 grayscale hover:grayscale-0 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-slate-600 line-through">
                    {key.name}
                  </span>
                  <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase">
                    Revoked
                  </span>
                </div>
                <Button
                  variant="ghost-danger"
                  size="icon"
                  onClick={() => handleDeleteKey(key.id, key.name)}
                  title="Delete permanently"
                  aria-label={`Delete key ${key.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Security Warning */}
      <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 font-medium leading-relaxed">
          API keys bypass normal authentication. Only share with trusted devices
          and revoke keys if your device is lost or compromised.
        </p>
      </div>
    </div>
  );
};

export default ApiKeyManager;
