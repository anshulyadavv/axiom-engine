import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { Clock, ArrowUpRight, Play } from 'lucide-react';
import { PageHeader, Button, SearchInput, EmptyState, Badge } from '../components/ui';

export const RunsList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeStatus = searchParams.get('status') || 'all';
  const [search, setSearch] = useState('');

  const { data: runsResponse, isLoading } = useQuery({ 
    queryKey: ['runs', activeStatus], 
    queryFn: () => api.getRuns(activeStatus === 'all' ? undefined : activeStatus),
    refetchInterval: 5000,
  });

  const runs = runsResponse?.data || [];
  
  const filteredRuns = runs.filter((run: any) => {
    const term = search.toLowerCase();
    const idMatches = run.id?.toLowerCase().includes(term);
    const wfMatches = run.workflow_id?.toLowerCase().includes(term) || run.workflow_name?.toLowerCase().includes(term);
    return idMatches || wfMatches;
  });

  const handleStatusChange = (status: string) => {
    if (status === 'all') {
      searchParams.delete('status');
    } else {
      searchParams.set('status', status);
    }
    setSearchParams(searchParams);
  };

  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title="Executions"
        description="Searchable execution log, active runs, and durable checkpoint records."
        actions={
          <Link to="/workflows">
            <Button variant="primary" size="sm" icon={<Play size={14} />}>
              Submit Workflow
            </Button>
          </Link>
        }
      />

      {/* Controls: Search & Status Filter Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ flex: 1, minWidth: '240px', maxWidth: '420px' }}>
          <SearchInput
            placeholder="Filter by Run ID or Workflow..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        </div>

        <div className="filter-tab-bar">
          {['all', 'running', 'completed', 'failed', 'cancelled'].map((tab) => (
            <button
              key={tab}
              className={`filter-tab ${activeStatus === tab ? 'active' : ''}`}
              onClick={() => handleStatusChange(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Runs Table */}
      <div className="table-wrapper">
        <div className="table-header-bar">
          <div className="table-header-title">
            <Clock size={16} style={{ color: 'var(--accent)' }} />
            <span>Workflow Executions</span>
            <Badge variant="neutral">{filteredRuns.length} total</Badge>
          </div>
        </div>

        <div className="table-container">
          {isLoading ? (
            <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading executions...
            </div>
          ) : filteredRuns.length === 0 ? (
            <EmptyState
              title={search ? 'No matching executions' : 'No executions found'}
              description={search ? `No runs matched "${search}".` : `No workflow executions currently match status "${activeStatus}".`}
              action={
                search ? (
                  <Button variant="secondary" size="sm" onClick={() => setSearch('')}>Clear Filter</Button>
                ) : activeStatus !== 'all' ? (
                  <Button variant="secondary" size="sm" onClick={() => handleStatusChange('all')}>Show All Runs</Button>
                ) : (
                  <Link to="/workflows">
                    <Button variant="primary" size="sm" icon={<Play size={14} />}>Start an Execution</Button>
                  </Link>
                )
              }
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Run ID</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Attempts</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run: any) => {
                  let badgeVariant: 'success' | 'error' | 'warning' | 'info' = 'info';
                  if (run.status === 'completed') badgeVariant = 'success';
                  if (run.status === 'failed') badgeVariant = 'error';
                  if (run.status === 'cancelled') badgeVariant = 'warning';

                  const duration = run.completed_at && (run.started_at || run.created_at)
                    ? new Date(run.completed_at).getTime() - new Date(run.started_at || run.created_at).getTime()
                    : null;

                  return (
                    <tr key={run.id}>
                      <td style={{ fontWeight: 500 }}>
                        <Link to={`/workflows/${run.workflow_id}`}>
                          {run.workflow_name || run.workflow_id?.slice(0, 16) || 'Workflow'}
                        </Link>
                      </td>
                      <td className="font-mono">
                        <Link to={`/runs/${run.id}`} style={{ color: 'var(--accent)' }}>
                          {run.id}
                        </Link>
                      </td>
                      <td>
                        <Badge variant={badgeVariant} dot>
                          {run.status}
                        </Badge>
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {duration != null ? `${duration}ms` : '—'}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {run.attempts ?? 1}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {run.started_at || run.created_at 
                          ? formatDistanceToNow(new Date(run.started_at || run.created_at), { addSuffix: true }) 
                          : '—'}
                      </td>
                      <td>
                        <Link to={`/runs/${run.id}`}>
                          <Button variant="ghost" size="sm" icon={<ArrowUpRight size={12} />}>
                            Inspect
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
