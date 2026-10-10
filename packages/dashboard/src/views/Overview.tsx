import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { CheckCircledIcon, ClockIcon, CrossCircledIcon, Component1Icon, ActivityLogIcon, StackIcon, LightningBoltIcon } from '@radix-ui/react-icons';
import { motion, useAnimation, useSpring, useTransform } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { formatDistanceToNow, format, subDays, startOfDay, isSameDay } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';

const AnimatedNumber = ({ value }: { value: number }) => {
  const spring = useSpring(0, { bounce: 0, duration: 1000 });
  const display = useTransform(spring, (current) => Math.round(current));
  
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  
  return <motion.span>{display}</motion.span>;
};

export const Overview = () => {
  const navigate = useNavigate();
  const { data: overview, isLoading: overviewLoading } = useQuery({ queryKey: ['overview'], queryFn: api.getOverview });
  const { data: runsResponse, isLoading: runsLoading } = useQuery({ queryKey: ['runs'], queryFn: api.getRuns });
  
  const runs = runsResponse?.data || [];
  
  const loading = overviewLoading || runsLoading;

  if (loading) return (
    <div className="page-content" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
      {[1,2,3,4].map(i => (
        <div key={i} className="card" style={{ flex: '1 1 200px', height: '120px', display: 'flex', flexDirection: 'column', gap: '1rem', opacity: 0.5 }}>
          <div style={{ height: '16px', width: '40%', background: 'var(--border)', borderRadius: '4px' }} />
          <div style={{ height: '32px', width: '60%', background: 'var(--border)', borderRadius: '4px' }} />
        </div>
      ))}
    </div>
  );

  const totalCompleted = overview?.last24h.completed || 0;
  const totalFailed = overview?.last24h.failed || 0;
  const totalRunning = overview?.activeRuns || 0;
  
  const outcomeData = [
    { name: 'Completed', value: totalCompleted, color: 'var(--success)' },
    { name: 'Failed', value: totalFailed, color: 'var(--error)' },
    { name: 'Running', value: totalRunning, color: 'var(--info)' },
  ].filter(d => d.value > 0);

  const timeSeriesMap = new Map();
  for (let i = 6; i >= 0; i--) {
    const d = startOfDay(subDays(new Date(), i));
    timeSeriesMap.set(d.getTime(), { date: format(d, 'MMM dd'), total: 0, failed: 0, completed: 0 });
  }

  let avgDuration = 0;
  let durationCount = 0;

  runs.forEach((r: any) => {
    if (!r.started_at) return;
    const start = new Date(r.started_at);
    
    // Duration
    if (r.completed_at) {
      const dur = new Date(r.completed_at).getTime() - start.getTime();
      if (dur > 0) {
        avgDuration += dur;
        durationCount++;
      }
    }
    
    // Timeseries
    const day = startOfDay(start).getTime();
    if (timeSeriesMap.has(day)) {
      const entry = timeSeriesMap.get(day);
      entry.total++;
      if (r.status === 'completed') entry.completed++;
      if (r.status === 'failed') entry.failed++;
    }
  });
  
  const avgDurationMs = durationCount > 0 ? Math.round(avgDuration / durationCount) : 0;
  const successRate = totalCompleted + totalFailed > 0 
    ? Math.round((totalCompleted / (totalCompleted + totalFailed)) * 100) 
    : 100;

  const activityData = Array.from(timeSeriesMap.values());

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 5 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } }
  };

  return (
    <motion.div 
      className="page-content"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <motion.div variants={itemVariants} className="card interactive" onClick={() => navigate('/runs')}>
          <div className="card-header text-info">
            <div className="flex items-center gap-2"><ClockIcon width={16} height={16} /> Active Runs</div>
          </div>
          <div className="card-value"><AnimatedNumber value={overview?.activeRuns || 0} /></div>
        </motion.div>
        
        <motion.div variants={itemVariants} className="card interactive" onClick={() => navigate('/runs')}>
          <div className="card-header text-success">
            <div className="flex items-center gap-2"><CheckCircledIcon width={16} height={16} /> 24h Completed</div>
          </div>
          <div className="card-value"><AnimatedNumber value={overview?.last24h.completed || 0} /></div>
        </motion.div>
        
        <motion.div variants={itemVariants} className="card interactive" onClick={() => navigate('/runs')}>
          <div className="card-header text-error">
            <div className="flex items-center gap-2"><CrossCircledIcon width={16} height={16} /> 24h Failed</div>
          </div>
          <div className="card-value"><AnimatedNumber value={overview?.last24h.failed || 0} /></div>
        </motion.div>
        
        <motion.div variants={itemVariants} className="card">
          <div className="card-header">
            <div className="flex items-center gap-2"><ActivityLogIcon width={16} height={16} /> Success Rate</div>
          </div>
          <div className="card-value">
            <AnimatedNumber value={successRate} />%
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="card">
          <div className="card-header">
            <div className="flex items-center gap-2"><LightningBoltIcon width={16} height={16} /> Avg Duration</div>
          </div>
          <div className="card-value">
            <AnimatedNumber value={avgDurationMs} /> <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-secondary)' }}>ms</span>
          </div>
        </motion.div>
        
        <motion.div variants={itemVariants} className="card interactive" onClick={() => navigate('/workers')}>
          <div className="card-header">
            <div className="flex items-center gap-2"><Component1Icon width={16} height={16} /> Active Workers</div>
          </div>
          <div className="card-value"><AnimatedNumber value={overview?.systemHealth.workers || 0} /></div>
        </motion.div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <motion.div variants={itemVariants} className="card">
          <div className="card-header">Execution Activity (7 Days)</div>
          <div style={{ height: '250px', width: '100%', marginTop: '1rem' }}>
            {activityData.reduce((acc, v) => acc + v.total, 0) === 0 ? (
              <div className="flex items-center justify-center h-full text-secondary">No executions in the last 7 days.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorFail" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--error)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--error)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="var(--border-highlight)" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--border-highlight)" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', backdropFilter: 'blur(16px)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Area type="monotone" dataKey="total" stroke="var(--accent)" fillOpacity={1} fill="url(#colorTotal)" name="Total Runs" />
                  <Area type="monotone" dataKey="failed" stroke="var(--error)" fillOpacity={1} fill="url(#colorFail)" name="Failed Runs" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="card">
          <div className="card-header">Execution Outcomes (24h)</div>
          <div style={{ height: '250px', width: '100%', marginTop: '1rem' }}>
            {outcomeData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-secondary">No recent executions.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={outcomeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {outcomeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', backdropFilter: 'blur(16px)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem' }}>
        <motion.div variants={itemVariants} className="card" style={{ padding: 0 }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
            <span>Recent Activity</span>
            <Link to="/runs" className="text-sm font-semibold text-accent">View all</Link>
          </div>
          <div className="table-container">
            {!runs || runs.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>No recent runs found.</div>
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
                  {runs.slice(0, 5).map((run: any) => {
                    let badgeClass = 'badge-info';
                    if (run.status === 'completed') badgeClass = 'badge-success';
                    if (run.status === 'failed') badgeClass = 'badge-error';
                    if (run.status === 'cancelled') badgeClass = 'badge-warning';
                    
                    return (
                      <tr key={run.id}>
                        <td><Link to={`/runs/${run.id}`} className="font-mono">{run.id.slice(0, 8)}...</Link></td>
                        <td><span className={`badge ${badgeClass}`}>{run.status}</span></td>
                        <td className="text-secondary">{run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : '—'}</td>
                        <td className="text-secondary">{run.completed_at && run.started_at ? `${new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()}ms` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="card">
          <div className="card-header">System Health</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><StackIcon width={16} height={16} className="text-secondary" /> PostgreSQL</div>
              <span className={`badge badge-${overview?.systemHealth.postgres === 'ok' ? 'success' : 'error'}`}>{overview?.systemHealth.postgres}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><ActivityLogIcon width={16} height={16} className="text-secondary" /> NATS JetStream</div>
              <span className={`badge badge-${overview?.systemHealth.nats === 'ok' ? 'success' : 'error'}`}>{overview?.systemHealth.nats}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Component1Icon width={16} height={16} className="text-secondary" /> Worker Nodes</div>
              <span className={`badge badge-${overview?.systemHealth.workers > 0 ? 'success' : 'warning'}`}>{overview?.systemHealth.workers > 0 ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </motion.div>
      </div>

    </motion.div>
  );
};
