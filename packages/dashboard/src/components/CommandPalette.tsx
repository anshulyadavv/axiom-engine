import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  Search, 
  X, 
  Layers, 
  Clock, 
  Cpu, 
  Zap, 
  Key, 
  Settings as SettingsIcon, 
  BookOpen, 
  LayoutDashboard,
  ArrowRight
} from 'lucide-react';
import { api } from '../api';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  category: 'Navigation' | 'Workflows' | 'Executions' | 'Documentation';
  title: string;
  subtitle?: string;
  path: string;
  icon: React.ReactNode;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: api.getWorkflows,
    enabled: isOpen,
  });

  const { data: runsResponse } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(undefined, 15),
    enabled: isOpen,
  });

  const runs = runsResponse?.data || [];

  // Build items list
  const navItems: PaletteItem[] = [
    { id: 'nav-overview', category: 'Navigation', title: 'Overview Console', subtitle: 'Runtime telemetry & KPI strip', path: '/', icon: <LayoutDashboard size={14} /> },
    { id: 'nav-workflows', category: 'Navigation', title: 'Workflows Registry', subtitle: 'Definitions & version management', path: '/workflows', icon: <Layers size={14} /> },
    { id: 'nav-runs', category: 'Navigation', title: 'Executions Log', subtitle: 'Durable run histories & replay journals', path: '/runs', icon: <Clock size={14} /> },
    { id: 'nav-workers', category: 'Navigation', title: 'Worker Fleet', subtitle: 'Registered nodes & heartbeat monitor', path: '/workers', icon: <Cpu size={14} /> },
    { id: 'nav-devtools', category: 'Navigation', title: 'Development Tools', subtitle: 'Isolated test workload dispatchers', path: '/dev-tools', icon: <Zap size={14} /> },
    { id: 'nav-docs', category: 'Navigation', title: 'Documentation & User Guide', subtitle: 'Architecture, getting started & diagnostics', path: '/docs', icon: <BookOpen size={14} /> },
    { id: 'nav-apikeys', category: 'Navigation', title: 'API Keys', subtitle: 'Scoped Bearer credentials', path: '/api-keys', icon: <Key size={14} /> },
    { id: 'nav-settings', category: 'Navigation', title: 'Settings', subtitle: 'Connection endpoints & theme preferences', path: '/settings', icon: <SettingsIcon size={14} /> },
  ];

  const docsItems: PaletteItem[] = [
    { id: 'doc-overview', category: 'Documentation', title: 'Axiom Engine Overview', subtitle: 'Architecture & problem statement', path: '/docs#overview', icon: <BookOpen size={14} /> },
    { id: 'doc-concepts', category: 'Documentation', title: 'Core Concepts & Semantics', subtitle: 'Definitions, runs, steps & fencing', path: '/docs#concepts', icon: <BookOpen size={14} /> },
    { id: 'doc-quickstart', category: 'Documentation', title: 'Getting Started Guide', subtitle: 'Local run commands & prerequisites', path: '/docs#quickstart', icon: <BookOpen size={14} /> },
    { id: 'doc-troubleshoot', category: 'Documentation', title: 'Troubleshooting & Diagnostics', subtitle: 'Common errors & resolutions', path: '/docs#troubleshooting', icon: <BookOpen size={14} /> },
    { id: 'doc-architecture', category: 'Documentation', title: 'Runtime Guarantees & Invariants', subtitle: 'Durability model & failure taxonomy', path: '/docs#architecture', icon: <BookOpen size={14} /> },
  ];

  const workflowItems: PaletteItem[] = workflows.map((wf: any) => ({
    id: `wf-${wf.id}`,
    category: 'Workflows',
    title: wf.name,
    subtitle: `v${wf.version} ${wf.description ? '— ' + wf.description : ''}`,
    path: `/workflows/${wf.id}`,
    icon: <Layers size={14} />
  }));

  const runItems: PaletteItem[] = runs.slice(0, 8).map((run: any) => ({
    id: `run-${run.id}`,
    category: 'Executions',
    title: run.workflow_name || run.workflow_id || 'Execution',
    subtitle: `Run ID: ${run.id.slice(0, 12)}... (${run.status})`,
    path: `/runs/${run.id}`,
    icon: <Clock size={14} />
  }));

  const allItems: PaletteItem[] = [...navItems, ...docsItems, ...workflowItems, ...runItems];

  const filteredItems = allItems.filter(item => {
    if (!query.trim()) return true;
    const term = query.toLowerCase();
    return item.title.toLowerCase().includes(term) ||
           (item.subtitle && item.subtitle.toLowerCase().includes(term)) ||
           item.category.toLowerCase().includes(term);
  });

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [query]);

  useEffect(() => {
    if (!listRef.current || filteredItems.length === 0) return;
    const container = listRef.current;
    const selectedEl = container.children[selectedIndex] as HTMLElement | undefined;
    if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, filteredItems.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelect = (item: PaletteItem) => {
    onClose();
    if (item.path.includes('#')) {
      const [route, hash] = item.path.split('#');
      navigate(route);
      setTimeout(() => {
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } else {
      navigate(item.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < filteredItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        handleSelect(filteredItems[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 120, alignItems: 'flex-start', paddingTop: '10vh' }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '600px', borderRadius: 'var(--radius-lg)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-default)', gap: '0.625rem' }}>
          <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Search workflows, executions, docs, or pages..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            autoFocus
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              boxShadow: 'none',
              color: 'var(--text-primary)',
              caretColor: 'var(--accent)',
              fontSize: 'var(--font-size-base)',
              width: '100%',
              padding: '0.25rem 0.5rem',
              margin: 0,
              height: '36px',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            ESC
          </span>
        </div>

        <div ref={listRef} style={{ maxHeight: '360px', overflowY: 'auto', padding: '0.5rem' }}>
          {filteredItems.length === 0 ? (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              No matches found for "{query}".
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isSelected ? 'var(--bg-surface-elevated)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background-color 0.1s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                    <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>
                      {item.icon}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: '0.75rem' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', padding: '1px 5px', borderRadius: 'var(--radius-sm)' }}>
                      {item.category}
                    </span>
                    {isSelected && <ArrowRight size={12} style={{ color: 'var(--accent)' }} />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ padding: '0.625rem 1.25rem', backgroundColor: 'var(--bg-surface-elevated)', borderTop: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
          <span>Navigation: <strong className="font-mono">↑ ↓</strong> to select</span>
          <span>Open: <strong className="font-mono">ENTER</strong></span>
          <span>Close: <strong className="font-mono">ESC</strong></span>
        </div>
      </div>
    </div>
  );
};
