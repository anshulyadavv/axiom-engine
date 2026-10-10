import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { ActivityLogIcon, CubeIcon, ClockIcon, DashboardIcon, GearIcon, LockClosedIcon, MagnifyingGlassIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';

// Views
import { Overview } from './views/Overview';
import { WorkflowsList } from './views/WorkflowsList';
import { WorkflowDetail } from './views/WorkflowDetail';
import { RunDetail } from './views/RunDetail';
import { Settings } from './views/Settings';
import { ApiKeys } from './views/ApiKeys';
import { RunsList } from './views/RunsList';
import { WorkersList } from './views/WorkersList';
import { api } from './api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: (q) => {
        const data = q.state.data as any;
        if (data?.status === 'running' || data?.status === 'pending') return 2000;
        return false;
      }
    }
  }
});

const SearchBar = () => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: results, isFetching } = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: query.length > 0,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ position: 'relative', margin: '0.75rem 1rem' }}>
      <div className="search-container">
        <MagnifyingGlassIcon width={16} height={16} className="search-icon" />
        <input 
          type="text" 
          placeholder="Search resources..." 
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if(query) setOpen(true); }}
          className="search-input"
        />
      </div>
      <AnimatePresence>
        {open && query && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="search-dropdown"
          >
            {isFetching ? <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>Searching...</div> : 
             !results?.length ? <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>No results found.</div> : 
             results.map((res: any, idx: number) => {
               return (
                 <div 
                   key={idx}
                   onClick={() => {
                     if (res.type === 'Workflow') navigate(`/workflows/${res.id}`);
                     if (res.type === 'Run') navigate(`/runs/${res.id}`);
                     if (res.type === 'Step') navigate(`/runs/${res.run_id}`);
                     setOpen(false);
                   }}
                   style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}
                   className="timeline-link"
                 >
                   <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{res.type}: {res.name || res.workflow_name || res.step_id}</div>
                   <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{res.id || res.run_id}</div>
                 </div>
               )
             })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Sidebar = () => {
  const location = useLocation();
  
  const navItems = [
    { name: 'Overview', path: '/', icon: DashboardIcon },
    { name: 'Workflows', path: '/workflows', icon: CubeIcon },
    { name: 'Runs', path: '/runs', icon: ClockIcon },
    { name: 'Workers', path: '/workers', icon: ActivityLogIcon },
    { name: 'API Keys', path: '/api-keys', icon: LockClosedIcon },
    { name: 'Settings', path: '/settings', icon: GearIcon },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <CubeIcon width={24} height={24} color="var(--accent)" />
        <span>Axiom Engine</span>
      </div>
      <SearchBar />
      <div className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path || 
                           (item.path !== '/' && location.pathname.startsWith(item.path));
          
          return (
            <Link 
              key={item.name} 
              to={item.path} 
              className={clsx('nav-item', isActive && 'active')}
            >
              <Icon width={18} height={18} />
              {item.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

const TopBar = () => {
  const location = useLocation();
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system');

  const getPageTitle = () => {
    if (location.pathname === '/') return 'Overview';
    if (location.pathname.startsWith('/workflows')) return 'Workflows';
    if (location.pathname.startsWith('/runs')) return 'Runs';
    if (location.pathname.startsWith('/workers')) return 'Workers';
    if (location.pathname.startsWith('/api-keys')) return 'API Keys';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    return '';
  };

  const applyTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem('theme', t);
    if (t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  useEffect(() => {
    applyTheme(theme);
  }, []);

  return (
    <div className="top-bar">
      <div style={{ fontWeight: 600, fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
        {getPageTitle()}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <button className={clsx('btn btn-ghost', theme === 'light' && 'btn-secondary')} style={{ padding: '0.25rem', border: 'none', background: theme === 'light' ? 'var(--bg-primary)' : 'transparent', borderRadius: '4px', boxShadow: theme === 'light' ? 'var(--shadow-sm)' : 'none' }} onClick={() => applyTheme('light')} title="Light Mode">
          <SunIcon width={16} height={16} />
        </button>
        <button className={clsx('btn btn-ghost', theme === 'dark' && 'btn-secondary')} style={{ padding: '0.25rem', border: 'none', background: theme === 'dark' ? 'var(--bg-primary)' : 'transparent', borderRadius: '4px', boxShadow: theme === 'dark' ? 'var(--shadow-sm)' : 'none' }} onClick={() => applyTheme('dark')} title="Dark Mode">
          <MoonIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
};

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.15 }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        <Routes location={location}>
          <Route path="/" element={<Overview />} />
          <Route path="/workflows" element={<WorkflowsList />} />
          <Route path="/workflows/:id" element={<WorkflowDetail />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/api-keys" element={<ApiKeys />} />
          <Route path="/runs" element={<RunsList />} />
          <Route path="/workers" element={<WorkersList />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="dashboard-layout">
          <Sidebar />
          <div className="main-content">
            <TopBar />
            <AnimatedRoutes />
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
