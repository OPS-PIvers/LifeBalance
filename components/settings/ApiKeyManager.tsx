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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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
  const [pendingAction, setPendingAction] = useState<
    { type: 'revoke' | 'delete'; keyId: string; keyName: string } | null
  >(null);
  const [isActionPending, setIsActionPending] = useState(false);

  if (!isAdmin) {
    return (
      <div className="text-center py-6 text-brand-500 dark:text-brand-400">
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

  const handleRevokeKey = (keyId: string, keyName: string) => {
    setPendingAction({ type: 'revoke', keyId, keyName });
  };

  const handleDeleteKey = (keyId: string, keyName: string) => {
    setPendingAction({ type: 'delete', keyId, keyName });
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const { type, keyId } = pendingAction;
    setIsActionPending(true);
    try {
      if (type === 'revoke') {
        await revokeApiKey(householdId, keyId);
        toast.success('API key revoked');
      } else {
        await deleteApiKey(householdId, keyId);
        toast.success('API key deleted');
      }
      setPendingAction(null);
    } catch (error) {
      console.error(`Failed to ${type} API key:`, error);
      toast.error(`Failed to ${type} API key`);
    } finally {
      setIsActionPending(false);
    }
  };

  const activeKeys = apiKeys.filter((k) => k.status === 'active');
  const revokedKeys = apiKeys.filter((k) => k.status === 'revoked');

  return (
    <div className="space-y-4">
      {/* Newly Created Key Warning */}
      {newlyCreatedKey && (
        <div className="bg-warm-50 border border-warm-200 rounded-card p-4 space-y-3 dark:bg-warm-500/10 dark:border-warm-500/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-warm-800 dark:text-warm-200">Copy your API key now!</p>
              <p className="text-sm text-warm-700 dark:text-warm-300">
                This is the only time you will see this key. Store it securely.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-brand-900 px-3 py-2 rounded-btn border border-warm-200 dark:border-warm-500/30 text-sm font-mono break-all text-brand-900 dark:text-brand-100">
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
          <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Active Keys</h4>
          {activeKeys.map((key) => (
            <div
              key={key.id}
              className="surface-section p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-brand-500 dark:text-brand-400" />
                  <span className="font-semibold text-brand-900 dark:text-brand-100">{key.name}</span>
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
              <div className="flex items-center gap-4 text-xs text-brand-500 dark:text-brand-400">
                <code className="bg-brand-100 dark:bg-brand-700 px-2 py-0.5 rounded-sm font-mono text-brand-700 dark:text-brand-200">{key.keyPrefix}...</code>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {key.lastUsedAt
                    ? `Used ${formatDistanceToNow(new Date(key.lastUsedAt))} ago`
                    : 'Never used'}
                </span>
                <span className="tabular-nums">{key.usageCount} calls</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {key.permissions.habits && (
                  <span className="text-xs bg-warm-50 text-warm-700 border border-warm-200 px-2 py-0.5 rounded-full dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/30">
                    Habits
                  </span>
                )}
                {key.permissions.expenses && (
                  <span className="text-xs bg-accent-50 text-accent-700 border border-accent-200 px-2 py-0.5 rounded-full dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30">
                    Expenses
                  </span>
                )}
                {key.permissions.shoppingList && (
                  <span className="text-xs bg-habit-blue/15 text-habit-blue border border-habit-blue/30 px-2 py-0.5 rounded-full">
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
        <div className="surface-section bg-brand-50 dark:bg-brand-800 p-4 space-y-4">
          <h4 className="font-display font-semibold text-brand-900 dark:text-brand-100">Create New API Key</h4>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-1.5">
              Key Name
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., iPhone Shortcut"
              className="w-full px-3 py-2 bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-btn text-brand-900 dark:text-brand-100 outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard)"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-2">
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
                  className="rounded-sm border-brand-300 dark:border-brand-600 text-accent-600 focus:ring-accent-500"
                />
                <span className="text-sm text-brand-700 dark:text-brand-200">Habits (toggle habits)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissions.expenses}
                  onChange={(e) =>
                    setPermissions({ ...permissions, expenses: e.target.checked })
                  }
                  className="rounded-sm border-brand-300 dark:border-brand-600 text-accent-600 focus:ring-accent-500"
                />
                <span className="text-sm text-brand-700 dark:text-brand-200">Expenses (add transactions)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissions.shoppingList}
                  onChange={(e) =>
                    setPermissions({ ...permissions, shoppingList: e.target.checked })
                  }
                  className="rounded-sm border-brand-300 dark:border-brand-600 text-accent-600 focus:ring-accent-500"
                />
                <span className="text-sm text-brand-700 dark:text-brand-200">Shopping List (add items)</span>
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
      <div className="surface-section bg-brand-50 dark:bg-brand-800 p-4 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Endpoint URLs</h4>
        <p className="text-xs text-brand-500 dark:text-brand-400">
          Use these URLs in your iOS Shortcuts with your API key.
        </p>
        <div className="space-y-1">
          {(['habit', 'expense', 'shopping'] as const).map((endpoint) => (
            <button
              key={endpoint}
              onClick={() => handleCopyEndpoint(endpoint)}
              className="w-full flex items-center justify-between px-2 py-1.5 bg-white dark:bg-brand-900 rounded-sm border border-brand-200 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) text-left"
            >
              <span className="text-xs font-mono text-brand-600 dark:text-brand-300 truncate">
                {getQuickAddEndpointUrl(endpoint)}
              </span>
              <Copy className="w-3 h-3 text-brand-400 dark:text-brand-500 shrink-0 ml-2" />
            </button>
          ))}
        </div>
      </div>

      {/* Revoked Keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Revoked Keys</h4>
          {revokedKeys.map((key) => (
            <div
              key={key.id}
              className="surface-section bg-brand-50 dark:bg-brand-800 p-3 opacity-60"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-brand-400 dark:text-brand-500" />
                  <span className="font-semibold text-brand-600 dark:text-brand-300 line-through">
                    {key.name}
                  </span>
                  <span className="text-xs bg-brand-200 dark:bg-brand-700 text-brand-600 dark:text-brand-300 px-2 py-0.5 rounded-full">
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
      <div className="bg-warm-50 border border-warm-200 rounded-btn p-3 flex items-start gap-2 dark:bg-warm-500/10 dark:border-warm-500/30">
        <AlertTriangle className="w-4 h-4 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
        <p className="text-xs text-warm-700 dark:text-warm-300">
          API keys bypass normal authentication. Only share with trusted devices
          and revoke keys if your device is lost or compromised.
        </p>
      </div>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={handleConfirmAction}
        isConfirming={isActionPending}
        title={pendingAction?.type === 'delete' ? 'Delete API key' : 'Revoke API key'}
        confirmLabel={pendingAction?.type === 'delete' ? 'Delete' : 'Revoke'}
        message={
          pendingAction?.type === 'delete'
            ? `Permanently delete "${pendingAction?.keyName}"? This cannot be undone.`
            : `Revoke "${pendingAction?.keyName}"? This will immediately stop all shortcuts using this key.`
        }
      />
    </div>
  );
};

export default ApiKeyManager;
