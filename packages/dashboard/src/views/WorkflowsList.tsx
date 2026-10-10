import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { motion, AnimatePresence } from 'framer-motion';
import { CubeIcon, PlusIcon, MagnifyingGlassIcon, Cross1Icon } from '@radix-ui/react-icons';

export const WorkflowsList = () => {
  const queryClient = useQueryClient();
  const { data: workflows, isLoading } = useQuery({ queryKey: ['workflows'], queryFn: api.getWorkflows });
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

  const filteredWorkflows = workflows?.filter((wf: any) => 
    wf.name.toLowerCase().includes(search.toLowerCase()) || 
    (wf.description && wf.description.toLowerCase().includes(search.toLowerCase()))
  ) || [];

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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Workflows</span>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <PlusIcon width={16} height={16} /> Register Workflow
        </button>
      </div>
      
      <AnimatePresence>
        {showModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="modal-overlay"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
            >
              <div className="modal-header">
                Register Workflow
              </div>
              <div className="modal-body flex" style={{ flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label>Name</label>
                  <input type="text" placeholder="e.g. process_payment" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <label>Version</label>
                  <input type="number" min="1" value={version} onChange={e => setVersion(parseInt(e.target.value) || 1)} />
                </div>
                <div>
                  <label>Description</label>
                  <textarea placeholder="Optional description..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => registerMutation.mutate()} disabled={registerMutation.isPending || !name.trim()}>
                  {registerMutation.isPending ? 'Registering...' : 'Register'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="page-content" style={{ flex: 1 }}>
        <div style={{ marginBottom: '1.5rem', maxWidth: '300px', position: 'relative' }}>
          <MagnifyingGlassIcon width={16} height={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            type="text" 
            placeholder="Search workflows..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>

        {isLoading ? (
          <div className="card" style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            Loading workflows...
          </div>
        ) : !workflows || workflows.length === 0 ? (
          <motion.div variants={itemVariants} className="card" style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <CubeIcon width={48} height={48} color="var(--border-highlight)" />
            <div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>No workflows found</div>
              <div>Register a workflow to get started with Axiom Engine.</div>
            </div>
            <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: '1rem' }}>
              <PlusIcon width={16} height={16} /> Register Workflow
            </button>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants} className="card" style={{ padding: 0 }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Active Runs</th>
                    <th>Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkflows.map((wf: any, idx: number) => (
                    <motion.tr 
                      key={wf.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                    >
                      <td style={{ fontWeight: 500 }}>
                        <Link to={`/workflows/${wf.id}`}>{wf.name}</Link>
                      </td>
                      <td>v{wf.version}</td>
                      <td>
                        <span className={`badge badge-${wf.status === 'active' ? 'success' : 'neutral'}`}>
                          {wf.status}
                        </span>
                      </td>
                      <td>{wf.activeRuns ?? '—'}</td>
                      <td>
                        {wf.successRate !== undefined ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '60px', height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ width: `${wf.successRate}%`, height: '100%', background: wf.successRate > 90 ? 'var(--success)' : wf.successRate > 70 ? 'var(--warning)' : 'var(--error)' }} />
                            </div>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{wf.successRate}%</span>
                          </div>
                        ) : '—'}
                      </td>
                    </motion.tr>
                  ))}
                  {filteredWorkflows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        No workflows match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
