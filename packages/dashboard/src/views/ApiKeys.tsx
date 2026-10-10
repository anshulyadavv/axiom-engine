import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { format } from 'date-fns';
import { LockClosedIcon, PlusIcon, TrashIcon, CopyIcon, LightningBoltIcon } from '@radix-ui/react-icons';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

export const ApiKeys = () => {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({ 
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
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <motion.div initial="hidden" animate="show" variants={containerVariants} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', flex: 1 }}>
        
        <motion.div variants={itemVariants} className="card">
          <div className="card-header" style={{ marginBottom: '1rem', fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
            Create New API Key
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '300px', maxWidth: '400px' }}>
              <input 
                type="text" 
                placeholder="Key Name (e.g. Production Service)"
                value={newKeyName} 
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter' && newKeyName.trim()) createMutation.mutate(newKeyName); }}
              />
            </div>
            <button 
              className="btn btn-primary"
              onClick={() => { if (newKeyName.trim()) createMutation.mutate(newKeyName); }}
              disabled={createMutation.isPending || !newKeyName.trim()}
            >
              <PlusIcon width={16} height={16} /> {createMutation.isPending ? 'Creating...' : 'Create Key'}
            </button>
          </div>

          <AnimatePresence>
            {createdKey && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ marginTop: '1.5rem', padding: '1.5rem', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: '8px', color: 'var(--warning)' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <LightningBoltIcon width={18} height={18} /> Important: Copy your new API Key now.
                  </div>
                  <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>It will never be shown again for security reasons.</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ flex: 1, fontFamily: 'var(--font-mono)', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--warning-border)', userSelect: 'all', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                      {createdKey}
                    </div>
                    <button className="btn btn-secondary" onClick={() => copyToClipboard(createdKey)} title="Copy to clipboard">
                      <CopyIcon width={16} height={16} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div variants={itemVariants} className="card" style={{ padding: 0 }}>
          <div className="table-container">
            {isLoading ? (
               <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading keys...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Revoked</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys?.map((k: any, idx: number) => (
                    <motion.tr 
                      key={k.key_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                    >
                      <td style={{ fontWeight: 500 }}>
                        <div className="flex items-center gap-2">
                          <LockClosedIcon width={16} height={16} color="var(--text-tertiary)" />
                          {k.description || k.key_id}
                        </div>
                      </td>
                      <td>
                        {k.is_active ? (
                          <span className="badge badge-success">Active</span>
                        ) : (
                          <span className="badge badge-error">Revoked</span>
                        )}
                      </td>
                      <td className="text-secondary">
                        {format(new Date(k.created_at), 'MMM d, yyyy HH:mm')}
                      </td>
                      <td className="text-secondary">
                        {k.revoked_at ? format(new Date(k.revoked_at), 'MMM d, yyyy HH:mm') : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {k.is_active && (
                          <button 
                            className="btn btn-ghost"
                            onClick={() => { if(confirm('Are you sure you want to revoke this key?')) revokeMutation.mutate(k.key_id); }}
                            style={{ color: 'var(--error)', padding: '0.25rem 0.5rem' }}
                            title="Revoke Key"
                          >
                            <TrashIcon width={16} height={16} /> <span style={{ fontSize: 'var(--text-xs)' }}>Revoke</span>
                          </button>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                  {(!keys || keys.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        No API keys found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
};
