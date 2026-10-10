import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { formatDistanceToNow, format } from 'date-fns';
import { CheckCircledIcon, ClockIcon, CrossCircledIcon, UpdateIcon, LightningBoltIcon, Link2Icon, CopyIcon, Component1Icon } from '@radix-ui/react-icons';
import clsx from 'clsx';
import { motion } from 'framer-motion';

export const RunDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading } = useQuery({ 
    queryKey: ['run', id], 
    queryFn: () => api.getRunTimeline(id!) 
  });
  
  const [activeTab, setActiveTab] = useState<'timeline' | 'events'>('timeline');

  const timelineItems = useMemo(() => {
    if (!run) return [];
    const items: Array<{ id: string, type: string, time: Date, data: any }> = [];

    run.steps?.forEach((step: any) => {
      const time = new Date(step.started_at || Date.now());
      items.push({ id: `step-${step.step_id}-${step.attempt}`, type: 'step', time, data: step });
    });

    run.children?.forEach((child: any) => {
      const time = new Date(child.started_at || child.completed_at || Date.now());
      items.push({ id: `child-${child.child_run_id}`, type: 'child', time, data: child });
    });

    if (run.created_at) {
        items.push({ id: 'run-start', type: 'run_start', time: new Date(run.created_at), data: run });
    }
    if (run.completed_at) {
        items.push({ id: 'run-end', type: 'run_end', time: new Date(run.completed_at), data: run });
    }

    return items.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [run]);

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

  if (isLoading || !run) return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ height: '100px', opacity: 0.5 }} />
      <div className="card" style={{ height: '400px', opacity: 0.5 }} />
    </div>
  );

  let headerBadge = 'badge-info';
  if (run.status === 'completed') headerBadge = 'badge-success';
  if (run.status === 'failed' || run.status === 'version_mismatch') headerBadge = 'badge-error';
  if (run.status === 'cancelled') headerBadge = 'badge-warning';

  return (
    <motion.div initial="hidden" animate="show" variants={containerVariants} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header gap-4">
        <span style={{ fontFamily: 'var(--font-mono)' }}>{run.id}</span>
        <button className="btn btn-ghost" onClick={() => copyToClipboard(run.id)} style={{ padding: '0.25rem' }} title="Copy ID">
          <CopyIcon width={16} height={16} />
        </button>
        <span className={`badge ${headerBadge}`}>{run.status}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1rem', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          <span className="flex items-center gap-2"><ClockIcon width={16} height={16} /> Started {run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : 'Pending'}</span>
        </div>
      </div>
      
      <div className="page-content" style={{ flex: 1 }}>
        <motion.div variants={itemVariants} className="card" style={{ padding: 0, marginBottom: '2rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
            <button 
              onClick={() => setActiveTab('timeline')}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'timeline' ? '2px solid var(--accent)' : '2px solid transparent',
                padding: '1rem 1.5rem',
                color: activeTab === 'timeline' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'timeline' ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Execution Timeline
            </button>
            <button 
              onClick={() => setActiveTab('events')}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'events' ? '2px solid var(--accent)' : '2px solid transparent',
                padding: '1rem 1.5rem',
                color: activeTab === 'events' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'events' ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Raw Semantic Events
            </button>
          </div>
          
          <div style={{ padding: '1.5rem', flex: 1, overflowY: 'auto' }}>
            {activeTab === 'timeline' && (
              <div style={{ fontFamily: 'var(--font-mono)' }}>
                {timelineItems.length === 0 && <div style={{ color: 'var(--text-tertiary)', padding: '2rem', textAlign: 'center' }}>No execution history yet.</div>}
                
                {timelineItems.map((item, idx) => {
                  let icon = <ClockIcon width={16} height={16} color="var(--text-tertiary)" />;
                  let color = 'var(--text-secondary)';
                  let label = item.type;
                  let details = '';

                  if (item.type === 'step') {
                      label = `Step: ${item.data.step_id}`;
                      details = `${item.data.duration_ms ? item.data.duration_ms + 'ms' : '—'}`;
                      if (item.data.status === 'completed') {
                          icon = <CheckCircledIcon width={16} height={16} color="var(--success)" />;
                          color = 'var(--text-primary)';
                      } else if (item.data.status === 'failed') {
                          icon = <CrossCircledIcon width={16} height={16} color="var(--error)" />;
                          color = 'var(--error)';
                      } else if (item.data.status === 'running') {
                          icon = <UpdateIcon width={16} height={16} color="var(--info)" />;
                          color = 'var(--info)';
                      }
                  } else if (item.type === 'child') {
                      label = `Child Workflow: ${item.data.parent_operation_id}`;
                      details = item.data.child_run_id;
                      icon = <Link2Icon width={16} height={16} color="var(--accent)" />;
                      if (item.data.status === 'completed') {
                          color = 'var(--success)';
                      } else if (item.data.status === 'failed') {
                          color = 'var(--error)';
                          icon = <CrossCircledIcon width={16} height={16} color="var(--error)" />;
                      } else {
                          color = 'var(--info)';
                      }
                  } else if (item.type === 'run_start') {
                      label = `Workflow Started: ${run.workflowName}@${run.workflow_version}`;
                      icon = <LightningBoltIcon width={16} height={16} color="var(--accent)" />;
                      color = 'var(--text-primary)';
                  } else if (item.type === 'run_end') {
                      label = `Workflow Completed`;
                      icon = <CheckCircledIcon width={16} height={16} color="var(--success)" />;
                      if (run.status === 'failed') {
                          label = 'Workflow Failed';
                          icon = <CrossCircledIcon width={16} height={16} color="var(--error)" />;
                          color = 'var(--error)';
                      } else {
                          color = 'var(--text-primary)';
                      }
                  }

                  const rowContent = (
                    <>
                      <div style={{ width: '80px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {format(item.time, 'HH:mm:ss.SSS')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px' }}>
                        {icon}
                      </div>
                      <span style={{ flex: 1, fontWeight: item.type === 'run_start' || item.type === 'run_end' ? 600 : 500 }}>{label}</span>
                      {item.type === 'step' && item.data.attempt > 1 && <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)', padding: '0 1rem' }}>Attempt {item.data.attempt}</span>}
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{details}</span>
                    </>
                  );

                  if (item.type === 'child' && item.data.child_run_id) {
                    return (
                      <Link to={`/runs/${item.data.child_run_id}`} key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1rem', color, borderBottom: idx < timelineItems.length - 1 ? '1px solid var(--border-subtle)' : 'none', textDecoration: 'none', transition: 'background-color 0.2s', borderRadius: '4px' }} className="timeline-link">
                        {rowContent}
                      </Link>
                    );
                  }

                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1rem', color, borderBottom: idx < timelineItems.length - 1 ? '1px solid var(--border-subtle)' : 'none', borderRadius: '4px', transition: 'background-color 0.2s' }} className="timeline-link">
                      {rowContent}
                    </div>
                  );
                })}
              </div>
            )}
            
            {activeTab === 'events' && (
              <div className="table-container">
                <table style={{ fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr>
                      <th>Seq</th>
                      <th>Type</th>
                      <th>Timestamp</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.events?.map((event: any, idx: number) => (
                      <motion.tr 
                        key={event.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.02 }}
                      >
                        <td style={{ color: 'var(--text-tertiary)' }}>{event.sequence_number}</td>
                        <td style={{ fontWeight: 500, color: 'var(--accent)' }}>{event.event_type}</td>
                        <td className="text-secondary">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="text-secondary" style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {event.data ? JSON.stringify(event.data) : '{}'}
                        </td>
                      </motion.tr>
                    ))}
                    {(!run.events || run.events.length === 0) && (
                        <tr><td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>No events recorded.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};
