import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { Component1Icon } from '@radix-ui/react-icons';

export const WorkersList = () => {
  const { data: workersResponse, isLoading } = useQuery({ queryKey: ['workers'], queryFn: api.getWorkers });

  const workers = workersResponse?.data || [];

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
        {isLoading ? (
          <div className="card" style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            Loading workers...
          </div>
        ) : !workers || workers.length === 0 ? (
          <motion.div variants={itemVariants} className="card" style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <Component1Icon width={48} height={48} color="var(--border-highlight)" />
            <div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>No active workers</div>
              <div>Ensure your worker process is running and connected to NATS.</div>
            </div>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants} className="card" style={{ padding: 0 }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Worker ID</th>
                    <th>Status</th>
                    <th>Last Heartbeat</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((worker: any, idx: number) => {
                    let badgeClass = 'badge-success';
                    if (worker.status !== 'active') badgeClass = 'badge-warning';
                    
                    return (
                      <motion.tr 
                        key={worker.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                      >
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {worker.id}
                        </td>
                        <td>
                          <span className={`badge ${badgeClass}`}>{worker.status}</span>
                        </td>
                        <td className="text-secondary">
                          {formatDistanceToNow(new Date(worker.last_heartbeat), { addSuffix: true })}
                        </td>
                        <td className="text-secondary">
                          {formatDistanceToNow(new Date(worker.registered_at), { addSuffix: true })}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
