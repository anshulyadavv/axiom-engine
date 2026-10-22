import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { format } from 'date-fns';
import { Copy, Check, X } from 'lucide-react';
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
          <span className="card-title">Generate new API key</span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px', maxWidth: '400px' }}>
            <input 
              type="text" 
              placeholder="Key label (e.g. CI/CD Dispatcher, Worker)" 
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
          >
            Generate API Key
          </Button>
        </div>
      </div>

      {/* One-time Secret Disclosure Modal */}
      {createdKey && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ borderColor: 'var(--border-default)' }}>
            <div className="modal-header">
              <span style={{ fontWeight: 600 }}>API Key Generated</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setCreatedKey(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', marginBottom: '1rem' }}>
                <strong>Copy this key now.</strong> For security, this key cannot be displayed again after closing this window.
              </div>

              <label>Secret API Key Token</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input 
                  type="text" 
                  readOnly 
                  value={createdKey} 
                  className="font-mono" 
                  style={{ fontSize: '12px', backgroundColor: 'var(--bg-app)' }}
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
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing Keys Table */}
      <div className="table-wrapper">
        <div className="table-header-bar">
          <div className="table-header-title">
            <span>Active API Keys</span>
            {keys.length > 0 && (
              <Badge variant="neutral">{keys.length} keys</Badge>
            )}
          </div>
        </div>

        <div className="table-container">
          {isLoading ? (
            <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading credentials...
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
                  <th style={{ textAlign: 'right' }}>Actions</th>
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
                      <Badge variant="success">Active</Badge>
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {k.created_at ? format(new Date(k.created_at), 'yyyy-MM-dd HH:mm') : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Button 
                        variant="danger"
                        size="sm"
                        onClick={() => revokeMutation.mutate(k.id)}
                        isLoading={revokeMutation.isPending}
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
