import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { Box, Play, CheckCircle2, Clock, XCircle, Zap } from 'lucide-react';

const AnimatedNumber = ({ value }: { value: number }) => {
  const spring = useSpring(0, { bounce: 0, duration: 1000 });
  const display = useTransform(spring, (current) => Math.round(current));
  
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  
  return <motion.span>{display}</motion.span>;
};

export const WorkflowDetail = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: wf, isLoading } = useQuery({ 
    queryKey: ['workflow', id], 
    queryFn: () => api.getWorkflow(id!) 
  });
  
  const [showModal, setShowModal] = useState(false);
  const [inputJson, setInputJson] = useState('{}');

  const startRunMutation = useMutation({
    mutationFn: () => {
      const input = JSON.parse(inputJson);
      return api.startRun(id!, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', id] });
      setShowModal(false);
      setInputJson('{}');
    },
    onError: (error) => {
      alert("Failed to start run: " + error.message);
    }
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };

  if (isLoading || !wf) return (
    <div className="page-content" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
      {[1,2,3,4].map(i => (
        <div key={i} className="card" style={{ flex: '1 1 200px', height: '120px', opacity: 0.5 }}>
          <div style={{ height: '16px', width: '40%', background: 'var(--border)', borderRadius: '4px', marginBottom: '1rem' }} />
          <div style={{ height: '32px', width: '60%', background: 'var(--border)', borderRadius: '4px' }} />
        </div>
      ))}
    </div>
  );

  return (
    <motion.div initial="hidden" animate="show" variants={containerVariants} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Box size={24} color="var(--text-tertiary)" />
          <span>{wf.name}</span>
          <span className="badge badge-info">v{wf.version}</span>
          <span className={`badge badge-${wf.status === 'active' ? 'success' : 'warning'}`}>{wf.status}</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Play size={16} fill="currentColor" /> Start Run
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
                Start Run
              </div>
              <div className="modal-body flex" style={{ flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label>Input (JSON)</label>
                  <textarea 
                    value={inputJson} 
                    onChange={e => setInputJson(e.target.value)} 
                    style={{ width: '100%', height: '150px', fontFamily: 'var(--font-mono)' }} 
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => startRunMutation.mutate()} disabled={startRunMutation.isPending}>
                  {startRunMutation.isPending ? 'Starting...' : 'Start Run'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="page-content" style={{ flex: 1 }}>
        <motion.div variants={itemVariants} style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: 'var(--text-lg)' }}>
          {wf.description || 'No description provided.'}
        </motion.div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          <motion.div variants={itemVariants} className="card">
            <div className="card-header"><Box size={16} className="text-tertiary"/> Total Runs</div>
            <div className="card-value"><AnimatedNumber value={wf.stats.totalRuns} /></div>
          </motion.div>
          <motion.div variants={itemVariants} className="card">
            <div className="card-header text-info"><Clock size={16} /> Active Runs</div>
            <div className="card-value"><AnimatedNumber value={wf.stats.activeRuns} /></div>
          </motion.div>
          <motion.div variants={itemVariants} className="card">
            <div className="card-header text-success"><CheckCircle2 size={16} /> Success Rate</div>
            <div className="card-value"><AnimatedNumber value={wf.stats.successRate} />%</div>
          </motion.div>
          <motion.div variants={itemVariants} className="card">
            <div className="card-header"><Zap size={16} className="text-tertiary"/> Avg Duration</div>
            <div className="card-value"><AnimatedNumber value={wf.stats.avgDurationMs} /> <span className="text-lg text-secondary">ms</span></div>
          </motion.div>
        </div>

        <motion.div variants={itemVariants} className="card" style={{ padding: 0 }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>
            Recent Runs
          </div>
          <div className="table-container">
            {(!wf.recentRuns || wf.recentRuns.length === 0) ? (
              <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <Clock size={48} color="var(--border-highlight)" />
                <div>No recent runs found. Start a run to see it here.</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {wf.recentRuns.map((run: any) => {
                    let badgeClass = 'badge-info';
                    if (run.status === 'completed') badgeClass = 'badge-success';
                    if (run.status === 'failed') badgeClass = 'badge-error';
                    if (run.status === 'cancelled') badgeClass = 'badge-warning';
                    
                    return (
                      <tr key={run.id}>
                        <td>
                          <Link to={`/runs/${run.id}`} className="font-mono">{run.id.slice(0, 8)}...</Link>
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`}>{run.status}</span>
                        </td>
                        <td className="text-secondary">
                          {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : '—'}
                        </td>
                        <td>
                          {run.durationMs ? `${run.durationMs}ms` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};
