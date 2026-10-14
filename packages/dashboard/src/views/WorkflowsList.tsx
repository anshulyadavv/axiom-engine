import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layers, Plus, ArrowUpRight, X } from 'lucide-react';
import { PageHeader, Button, SearchInput, EmptyState, Badge } from '../components/ui';

export const WorkflowsList = () => {
  const queryClient = useQueryClient();
  const { data: workflows = [], isLoading } = useQuery({ 
    queryKey: ['workflows'], 
    queryFn: api.getWorkflows 
  });
  
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState(1);
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');

  const registerMutation = useMutation({
    mutationFn: () => api.registerWorkflow({ name, version, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowModal(false);
      setName('');
      setVersion(1);
      setDescription('');
    }
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const filteredWorkflows = workflows.filter((wf: any) => 
    wf.name?.toLowerCase().includes(search.toLowerCase()) || 
    (wf.description && wf.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title="Workflows"
        description="Registered workflow definitions, version schemas, and entry points."
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowModal(true)}>
            Register Workflow
          </Button>
        }
      />

      {/* Search Input */}
      <div style={{ marginBottom: '1.25rem' }}>
        <SearchInput
          placeholder="Search workflows by name or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          fullWidth
        />
      </div>

      {/* Workflows Table */}
      <div className="table-wrapper">
        <div className="table-header-bar">
          <div className="table-header-title">
            <Layers size={16} style={{ color: 'var(--accent)' }} />
            <span>Workflow Definitions</span>
            <Badge variant="neutral">{filteredWorkflows.length} total</Badge>
          </div>
        </div>

        <div className="table-container">
          {isLoading ? (
            <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading workflow registry...
            </div>
          ) : filteredWorkflows.length === 0 ? (
            <EmptyState
              title={search ? 'No matching workflows' : 'No workflows registered'}
              description={search ? `No workflows matched "${search}". Try another query.` : 'Register a workflow definition to start dispatching durable runs.'}
              action={
                search ? (
                  <Button variant="secondary" size="sm" onClick={() => setSearch('')}>Clear Filter</Button>
                ) : (
                  <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowModal(true)}>
                    Register First Workflow
                  </Button>
                )
              }
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Workflow Name</th>
                  <th>ID</th>
                  <th>Version</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkflows.map((wf: any) => (
                  <tr key={wf.id}>
                    <td style={{ fontWeight: 600 }}>
                      <Link to={`/workflows/${wf.id}`} style={{ color: 'var(--text-primary)' }}>
                        {wf.name}
                      </Link>
                    </td>
                    <td className="font-mono text-muted" style={{ fontSize: '12px' }}>
                      {wf.id?.slice(0, 8)}...
                    </td>
                    <td className="tabular-nums">
                      <Badge variant="primary">v{wf.version}</Badge>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', maxWidth: '300px' }}>
                      {wf.description || '—'}
                    </td>
                    <td>
                      <Link to={`/workflows/${wf.id}`}>
                        <Button variant="secondary" size="sm" icon={<ArrowUpRight size={12} />}>
                          View Details
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Registration Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Register New Workflow</span>
              <button 
                className="btn btn-sm btn-ghost" 
                onClick={() => setShowModal(false)}
                aria-label="Close dialog"
                style={{ padding: '0.25rem' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label>Workflow Identifier / Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. process_payment" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                />
              </div>
              <div>
                <label>Version Number</label>
                <input 
                  type="number" 
                  min="1" 
                  value={version} 
                  onChange={e => setVersion(parseInt(e.target.value) || 1)} 
                />
              </div>
              <div>
                <label>Description (Optional)</label>
                <textarea 
                  placeholder="Operational purpose of this workflow..." 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  rows={3} 
                />
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button 
                variant="primary" 
                onClick={() => registerMutation.mutate()} 
                disabled={!name.trim()}
                isLoading={registerMutation.isPending}
              >
                Register Workflow
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
