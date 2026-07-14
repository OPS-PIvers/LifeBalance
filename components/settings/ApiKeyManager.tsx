import React, { useState } from 'react';
import { Key, Plus, Copy, Trash2, AlertTriangle, Clock, Shield, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Drawer } from '@/components/ui/Drawer';
import { HouseholdApiKey, ApiKeyPermissions } from '@/types/schema';
import {
  generateApiKey,
  regenerateApiKey,
  revokeApiKey,
  deleteApiKey,
  getQuickAddEndpointUrl,
} from '@/services/apiKeyService';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';

interface ApiKeyManagerProps {
  householdId: string;
  userId: string;
  apiKeys: HouseholdApiKey[];
  isAdmin: boolean;
  /**
   * Called with the raw key the moment it's generated (write-once). Lets the
   * sibling setup guide pre-fill and copy the `Bearer …` Authorization header,
   * so the user never has to hunt for the key.
   */
  onKeyGenerated?: (key: string) => void;
}

const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({
  householdId,
  userId,
  apiKeys,
  isAdmin,
  onKeyGenerated,
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
    { type: 'revoke' | 'delete' | 'regenerate'; keyId: string; keyName: string } | null
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
      onKeyGenerated?.(result.key);
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

  const handleRegenerateKey = (keyId: string, keyName: string) => {
    setPendingAction({ type: 'regenerate', keyId, keyName });
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const { type, keyId } = pendingAction;
    setIsActionPending(true);
    try {
      if (type === 'revoke') {
        await revokeApiKey(householdId, keyId);
        toast.success('API key revoked');
      } else if (type === 'regenerate') {
        const existing = apiKeys.find((k) => k.id === keyId);
        if (!existing) {
          toast.error('Key not found');
          return;
        }
        const result = await regenerateApiKey(
          householdId,
          keyId,
          existing.name,
          existing.permissions,
          userId
        );
        setNewlyCreatedKey(result.key);
        onKeyGenerated?.(result.key);
        toast.success('Key regenerated! Copy the new key — it won\'t be shown again.');
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
    <div className="space-y-6">
      {/* Newly Created Key Warning — the one legitimately-tinted ephemeral state */}
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
          <code className="block bg-white dark:bg-brand-900 px-3 py-2 rounded-btn border border-warm-200 dark:border-warm-500/30 text-sm font-mono break-all text-brand-900 dark:text-brand-100">
            {newlyCreatedKey}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleCopyKey(`Bearer ${newlyCreatedKey}`)}
              leftIcon={<Copy className="w-4 h-4" />}
            >
              Copy Authorization header
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleCopyKey(newlyCreatedKey)}
              leftIcon={<Copy className="w-4 h-4" />}
            >
              Copy key only
            </Button>
          </div>
          <p className="text-xs text-warm-700 dark:text-warm-300">
            The setup guide below is now pre-filled with this key — paste the Authorization header
            straight into your shortcuts.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNewlyCreatedKey(null)}
            className="w-full"
          >
            Got it
          </Button>
        </div>
      )}

      {/* Active Keys — one grouped surface, one hairline row per key */}
      {activeKeys.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">Active keys</p>
          <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
            For security, keys are shown only once and can&apos;t be copied again. Lost a key or fumbled the setup? Tap
            {' '}<RefreshCw className="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> to regenerate a fresh one — the name and permissions carry over.
          </p>
          <SurfaceList>
            {activeKeys.map((key) => (
              <Row key={key.id} className="items-start">
                <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center shrink-0">
                  <Key className="w-4 h-4 text-brand-500 dark:text-brand-400" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-brand-900 dark:text-brand-100 truncate">{key.name}</span>
                    <div className="flex items-center gap-1 shrink-0 -my-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRegenerateKey(key.id, key.name)}
                        title="Regenerate key"
                        aria-label={`Regenerate key ${key.name}`}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
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
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-500 dark:text-brand-400">
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
                      <Badge variant="warning" size="md">
                        Habits
                      </Badge>
                    )}
                    {key.permissions.expenses && (
                      <Badge variant="default" size="md">
                        Expenses
                      </Badge>
                    )}
                    {key.permissions.shoppingList && (
                      <span className="text-xs bg-habit-blue/15 text-habit-blue border border-habit-blue/30 px-2 py-0.5 rounded-full">
                        Shopping
                      </span>
                    )}
                  </div>
                </div>
              </Row>
            ))}
          </SurfaceList>
        </div>
      )}

      {/* Generate New Key — opens the create form in a bottom sheet */}
      <Button
        variant="secondary"
        onClick={() => setIsCreating(true)}
        leftIcon={<Plus className="w-4 h-4" />}
        className="w-full"
      >
        Generate New API Key
      </Button>

      {/* Endpoint URLs — plain tap-to-copy rows, no boxed panel of boxed buttons */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">Endpoint URLs</p>
        <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
          Paste these into your iOS Shortcuts along with your API key. Each endpoint accepts one type of data: habits, expenses, or shopping items.
        </p>
        <SurfaceList>
          {(['habit', 'expense', 'shopping'] as const).map((endpoint) => (
            <Row
              key={endpoint}
              interactive
              dense
              role="button"
              tabIndex={0}
              onClick={() => handleCopyEndpoint(endpoint)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCopyEndpoint(endpoint);
                }
              }}
              aria-label={`Copy ${endpoint} endpoint URL`}
            >
              <span className="flex-1 min-w-0 text-xs font-mono text-brand-600 dark:text-brand-300 truncate">
                {getQuickAddEndpointUrl(endpoint)}
              </span>
              <Copy className="w-3.5 h-3.5 text-brand-400 dark:text-brand-450 shrink-0" />
            </Row>
          ))}
        </SurfaceList>
      </div>

      {/* Revoked Keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">Revoked keys</p>
          <SurfaceList>
            {revokedKeys.map((key) => (
              <Row key={key.id} className="opacity-60">
                <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center shrink-0">
                  <Key className="w-4 h-4 text-brand-400 dark:text-brand-450" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="font-semibold text-brand-600 dark:text-brand-300 line-through truncate">
                    {key.name}
                  </span>
                  <Badge variant="neutral" size="md">
                    Revoked
                  </Badge>
                </div>
                <Button
                  variant="ghost-danger"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleDeleteKey(key.id, key.name)}
                  title="Delete permanently"
                  aria-label={`Delete key ${key.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Row>
            ))}
          </SurfaceList>
        </div>
      )}

      {/* Security note — a plain callout, no boxed chrome */}
      <div className="flex items-start gap-2 px-1">
        <AlertTriangle className="w-4 h-4 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
        <p className="text-xs text-brand-500 dark:text-brand-400">
          API keys bypass normal authentication. Only share with trusted devices
          and revoke keys if your device is lost or compromised.
        </p>
      </div>

      {/* Create Key — bottom sheet */}
      <Drawer
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        title="Create API Key"
        footer={
          <div className="flex gap-2 p-4 border-t border-brand-200 dark:border-brand-700">
            <Button variant="ghost" className="flex-1" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleCreateKey}
              isLoading={isLoading}
              disabled={!newKeyName.trim()}
            >
              Create Key
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Key Name"
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g., iPhone Shortcut"
          />

          <div className="space-y-2">
            <p className="block text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">
              Permissions
            </p>
            <SurfaceList>
              <Row>
                <label htmlFor="perm-habits" className="flex-1 text-sm text-brand-700 dark:text-brand-200 cursor-pointer">Habits (toggle habits)</label>
                <Switch
                  id="perm-habits"
                  checked={permissions.habits}
                  onCheckedChange={(checked) =>
                    setPermissions({ ...permissions, habits: checked })
                  }
                  aria-label="Habits (toggle habits)"
                />
              </Row>
              <Row>
                <label htmlFor="perm-expenses" className="flex-1 text-sm text-brand-700 dark:text-brand-200 cursor-pointer">Expenses (add transactions)</label>
                <Switch
                  id="perm-expenses"
                  checked={permissions.expenses}
                  onCheckedChange={(checked) =>
                    setPermissions({ ...permissions, expenses: checked })
                  }
                  aria-label="Expenses (add transactions)"
                />
              </Row>
              <Row>
                <label htmlFor="perm-shopping" className="flex-1 text-sm text-brand-700 dark:text-brand-200 cursor-pointer">Shopping List (add items)</label>
                <Switch
                  id="perm-shopping"
                  checked={permissions.shoppingList}
                  onCheckedChange={(checked) =>
                    setPermissions({ ...permissions, shoppingList: checked })
                  }
                  aria-label="Shopping List (add items)"
                />
              </Row>
            </SurfaceList>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={handleConfirmAction}
        isConfirming={isActionPending}
        title={
          pendingAction?.type === 'delete'
            ? 'Delete API key'
            : pendingAction?.type === 'regenerate'
              ? 'Regenerate API key'
              : 'Revoke API key'
        }
        confirmLabel={
          pendingAction?.type === 'delete'
            ? 'Delete'
            : pendingAction?.type === 'regenerate'
              ? 'Regenerate'
              : 'Revoke'
        }
        message={
          pendingAction?.type === 'delete'
            ? `Permanently delete "${pendingAction?.keyName}"? The key is removed forever and cannot be restored.`
            : pendingAction?.type === 'regenerate'
              ? `Regenerate "${pendingAction?.keyName}"? You'll get a fresh key to copy — its name and permissions stay the same. The current key stops working immediately, so update your shortcut with the new one.`
              : `Revoke "${pendingAction?.keyName}"? Shortcuts using this key will stop working immediately. The key stays listed under Revoked Keys until you delete it.`
        }
      />
    </div>
  );
};

export default ApiKeyManager;
