import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { MagnifyingGlassIcon, ClockIcon } from '@radix-ui/react-icons';

export const RunsList = () => {
  const { data: runsResponse, isLoading } = useQuery({ queryKey: ['runs'], queryFn: api.getRuns });
  const [search, setSearch] = useState('');

  const runs = runsResponse?.data || [];
  
  const filteredRuns = runs.filter((run: any) => 
    run.id.toLowerCase().includes(search.toLowerCase()) || 
    (run.workflow_id && run.workflow_id.toLowerCase().includes(search.toLowerCase())) ||
    run.status.toLowerCase().includes(search.toLowerCase())
  );

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
      <div className="page-content" style={{ flex: 1 }}>
        
        <div style={{ marginBottom: '1.5rem', maxWidth: '300px', position: 'relative' }}>
          <MagnifyingGlassIcon width={16} height={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            type="text" 
            placeholder="Filter runs..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>

        {isLoading ? (
          <div className="card" style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            Loading runs...
          </div>
        ) : !runs || runs.length === 0 ? (
          <motion.div variants={itemVariants} className="card" style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <ClockIcon width={48} height={48} color="var(--border-highlight)" />
            <div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>No runs found</div>
              <div>Trigger a run from a workflow to see it here.</div>
            </div>
            <Link to="/workflows" className="btn btn-primary" style={{ marginTop: '1rem' }}>View Workflows</Link>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants} className="card" style={{ padding: 0 }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Workflow ID</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((run: any, idx: number) => {
                    let badgeClass = 'badge-info';
                    if (run.status === 'completed') badgeClass = 'badge-success';
                    if (run.status === 'failed') badgeClass = 'badge-error';
                    if (run.status === 'cancelled') badgeClass = 'badge-warning';
                    
                    return (
                      <motion.tr 
                        key={run.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                      >
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          <Link to={`/runs/${run.id}`}>{run.id.slice(0, 12)}...</Link>
                        </td>
                        <td>
                          <Link to={`/workflows/${run.workflow_id}`} style={{ fontWeight: 500 }}>
                            {run.workflow_id.slice(0, 12)}...
                          </Link>
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`}>{run.status}</span>
                        </td>
                        <td className="text-secondary">
                          {run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : '—'}
                        </td>
                        <td>
                          {run.completed_at && run.started_at ? 
                            `${new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()}ms` : '—'}
                        </td>
                      </motion.tr>
                    );
                  })}
                  {filteredRuns.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        No runs match your search.
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
