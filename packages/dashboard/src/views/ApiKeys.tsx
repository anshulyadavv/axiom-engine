import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { format } from 'date-fns';
import { Key, Plus, Trash2, Copy, Check, ShieldCheck, AlertTriangle, X } from 'lucide-react';
import { PageHeader, Button, Badge, EmptyState } from '../components/ui';

export const ApiKeys = () => {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys = [], isLoading } = useQuery({ 
    queryKey: ['apiKeys'], 
    queryFn: api.getApiKeys 
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    }
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    }
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title="API Keys"
        description="Authenticate programmatic workflow triggers and worker clients via scoped Bearer API tokens."
      />

      {/* Creation Card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header">
          <span className="card-title">
            <Plus size={16} style={{ color: 'var(--accent)' }} />
            Generate New API Key
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px', maxWidth: '400px' }}>
            <input 
              type="text" 
              placeholder="Key label (e.g. CI/CD Dispatcher, Production Worker)" 
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newKeyName.trim()) {
                  createMutation.mutate(newKeyName.trim());
                }
              }}
            />
          </div>
          <Button 
            variant="primary" 
            disabled={!newKeyName.trim()}
            isLoading={createMutation.isPending}
            onClick={() => createMutation.mutate(newKeyName.trim())}
            icon={<Key size={14} />}
          >
            Generate API Key
          </Button>
        </div>
      </div>

      {/* One-time Secret Disclosure Modal */}
      {createdKey && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ borderColor: 'var(--accent-border)' }}>
            <div className="modal-header">
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)' }}>
                <ShieldCheck size={18} /> API Key Generated Successfully
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setCreatedKey(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--status-warning-bg)', border: '1px solid var(--status-warning-border)', borderRadius: 'var(--radius-md)', color: 'var(--status-warning)', fontSize: 'var(--font-size-xs)', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  <strong>Copy this key now.</strong> For your security, the secret key cannot be displayed again after closing this window.
                </span>
              </div>

              <label>Secret API Key Token</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input 
                  type="text" 
                  readOnly 
                  value={createdKey} 
                  className="font-mono" 
                  style={{ fontSize: '12px', backgroundColor: 'var(--bg-surface-elevated)' }}
                />
                <button 
                  className="btn btn-primary" 
                  onClick={() => copyToClipboard(createdKey)}
                  style={{ gap: '0.375rem' }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCreatedKey(null)}>
                I Have Saved My Secret Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing Keys Table */}
      <div className="table-wrapper">
        <div className="table-header-bar">
          <div className="table-header-title">
            <Key size={16} style={{ color: 'var(--accent)' }} />
            <span>Active API Keys</span>
            <span className="badge badge-neutral tabular-nums">{keys.length} keys</span>
          </div>
        </div>

        <div className="table-container">
          {isLoading ? (
            <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading active credentials...
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              title="No API keys configured"
              description="Generate a scoped API key to authenticate workflow submissions and worker clients."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Key Name</th>
                  <th>Key Prefix</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k: any) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600 }}>{k.name}</td>
                    <td className="font-mono text-muted" style={{ fontSize: '12px' }}>
                      {k.prefix || 'axm_live_••••'}
                    </td>
                    <td>
                      <Badge variant="success" dot>ACTIVE</Badge>
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {k.created_at ? format(new Date(k.created_at), 'yyyy-MM-dd HH:mm') : '—'}
                    </td>
                    <td>
                      <Button 
                        variant="danger"
                        size="sm"
                        onClick={() => revokeMutation.mutate(k.id)}
                        isLoading={revokeMutation.isPending}
                        icon={<Trash2 size={12} />}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
