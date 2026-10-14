import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { 
  Layers, 
  Clock, 
  Cpu, 
  Key, 
  Settings as SettingsIcon, 
  Zap, 
  LayoutDashboard, 
  Search, 
  Moon, 
  Sun, 
  User, 
  Menu, 
  Shield,
  BookOpen
} from 'lucide-react';

// Views
import { Overview } from './views/Overview';
import { WorkflowsList } from './views/WorkflowsList';
import { WorkflowDetail } from './views/WorkflowDetail';
import { RunDetail } from './views/RunDetail';
import { Settings } from './views/Settings';
import { ApiKeys } from './views/ApiKeys';
import { RunsList } from './views/RunsList';
import { WorkersList } from './views/WorkersList';
import { DevTools } from './views/DevTools';
import { Docs } from './views/Docs';
import { AuthModal } from './components/AuthModal';
import { CommandPalette } from './components/CommandPalette';
import { api } from './api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: (q) => {
        const data = q.state.data as any;
        if (data?.status === 'running' || data?.status === 'pending') return 3000;
        return false;
      }
    }
  }
});

const LocalClock = () => {
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      const tzPart = new Intl.DateTimeFormat([], { timeZoneName: 'short' })
        .formatToParts(now)
        .find(p => p.type === 'timeZoneName')?.value;
      if (tzPart) setTimezone(tzPart);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return null;

  return (
    <div className="local-clock" title={`Local System Time (${timezone || 'Local'})`}>
      <Clock size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span>{time}</span>
      {timezone && <span className="clock-timezone">{timezone}</span>}
    </div>
  );
};

const HeaderSearch = ({ onOpenPalette }: { onOpenPalette: () => void }) => {
  return (
    <div
      className="search-container"
      onClick={onOpenPalette}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenPalette();
        }
      }}
      aria-label="Open command palette"
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <Search size={14} className="search-icon" />
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', flex: 1, padding: '0 0.25rem' }}>
        Search...
      </span>
      <span className="search-shortcut">
        Ctrl+K
      </span>
    </div>
  );
};

const Sidebar = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const location = useLocation();
  
  const navItems = [
    { name: 'Overview', path: '/', icon: LayoutDashboard },
    { name: 'Workflows', path: '/workflows', icon: Layers },
    { name: 'Runs', path: '/runs', icon: Clock },
    { name: 'Workers', path: '/workers', icon: Cpu },
    { name: 'Dev Tools', path: '/dev-tools', icon: Zap, badge: 'DEV' },
    { name: 'Documentation', path: '/docs', icon: BookOpen },
    { name: 'API Keys', path: '/api-keys', icon: Key },
    { name: 'Settings', path: '/settings', icon: SettingsIcon },
  ];

  return (
    <>
      {isOpen && (
        <div 
          className="modal-overlay" 
          style={{ zIndex: 35 }} 
          onClick={onClose} 
        />
      )}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-title">
            <Shield size={18} style={{ color: 'var(--accent)' }} />
            <span>Axiom Engine</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || 
                             (item.path !== '/' && location.pathname.startsWith(item.path));
            
            return (
              <Link 
                key={item.name} 
                to={item.path} 
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <div className="nav-item-inner">
                  {isActive && <Icon size={16} />}
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className="badge badge-warning" style={{ fontSize: '9px', padding: '1px 4px' }}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--text-muted)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            width: '100%',
          }}>
            <span>v2.0-alpha</span>
            <a 
              href="https://github.com/anshulyadavv/axiom-engine" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ 
                color: 'var(--text-muted)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                padding: '4px',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                transition: 'color 0.15s ease'
              }}
              className="github-link"
              title="GitHub: anshulyadavv/axiom-engine"
              aria-label="GitHub Repository"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
};

const TopBar = ({ 
  onToggleSidebar,
  onOpenPalette 
}: { 
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
}) => {
  const location = useLocation();
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const { data: user } = useQuery({
    queryKey: ['auth_me'],
    queryFn: api.getMe,
  });

  const getPageTitle = () => {
    if (location.pathname === '/') return 'Overview';
    if (location.pathname.startsWith('/workflows')) return 'Workflows';
    if (location.pathname.startsWith('/runs')) return 'Executions';
    if (location.pathname.startsWith('/workers')) return 'Worker Fleet';
    if (location.pathname.startsWith('/dev-tools')) return 'Development Tools';
    if (location.pathname.startsWith('/docs')) return 'Documentation & User Guide';
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
    <header className="top-bar">
      <div className="top-bar-left">
        <button className="mobile-menu-btn" onClick={onToggleSidebar} aria-label="Toggle Navigation">
          <Menu size={18} />
        </button>
        <span className="top-bar-title">{getPageTitle()}</span>
      </div>

      <div className="top-bar-right">
        <LocalClock />
        <HeaderSearch onOpenPalette={onOpenPalette} />

        <button 
          className="btn btn-secondary btn-md"
          onClick={() => setAuthModalOpen(true)}
          style={{ 
            height: '36px',
            gap: '0.4rem', 
            padding: '0 0.75rem',
            maxWidth: '180px' 
          }}
          title={user ? `${user.email} (${user.role})` : 'Sign in to Axiom Engine'}
        >
          <User size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0, overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)' }}>
                {user.email.split('@')[0]}
              </span>
              <span className="badge badge-primary" style={{ fontSize: '9px', padding: '1px 4px', flexShrink: 0 }}>
                {user.role}
              </span>
            </div>
          ) : (
            <span>Sign In</span>
          )}
        </button>

        <button 
          className="btn btn-ghost btn-md"
          onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          style={{ width: '36px', height: '36px', padding: 0 }}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </header>
  );
};

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="dashboard-layout">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="main-content">
            <TopBar 
              onToggleSidebar={() => setSidebarOpen(prev => !prev)} 
              onOpenPalette={() => setPaletteOpen(true)}
            />
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/workflows" element={<WorkflowsList />} />
              <Route path="/workflows/:id" element={<WorkflowDetail />} />
              <Route path="/runs" element={<RunsList />} />
              <Route path="/runs/:id" element={<RunDetail />} />
              <Route path="/workers" element={<WorkersList />} />
              <Route path="/dev-tools" element={<DevTools />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/api-keys" element={<ApiKeys />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
          <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

