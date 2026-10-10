import { useState, useEffect } from 'react';
import { getApiConfig } from '../api';
import { motion } from 'framer-motion';
import { DashboardIcon, MoonIcon, SunIcon, PlusIcon, Link2Icon } from '@radix-ui/react-icons';
import clsx from 'clsx';

export const Settings = () => {
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const config = getApiConfig();
    setApiUrl(config.url);
    setApiKey(config.key);
    setTheme((localStorage.getItem('theme') as any) || 'system');
  }, []);

  const handleSaveApi = () => {
    localStorage.setItem('axiom_api_url', apiUrl);
    localStorage.setItem('axiom_api_key', apiKey);
    setIsSaved(true);
    setTimeout(() => {
      window.location.reload(); 
    }, 500);
  };

  const handleThemeChange = (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    
    if (newTheme === 'dark' || (newTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

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
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', flex: 1 }}>
        
        <motion.div variants={itemVariants} className="card" style={{ maxWidth: '600px' }}>
          <div className="card-header" style={{ marginBottom: '1.5rem', fontSize: 'var(--text-lg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link2Icon width={20} height={20} className="text-accent" /> API Connection
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label>API URL</label>
              <input 
                type="text" 
                value={apiUrl} 
                onChange={e => setApiUrl(e.target.value)} 
                placeholder="http://localhost:3000/v1"
              />
              <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                The base URL for the Axiom Engine API.
              </div>
            </div>
            <div>
              <label>API Key</label>
              <input 
                type="password" 
                value={apiKey} 
                onChange={e => setApiKey(e.target.value)} 
                placeholder="Enter your API key"
              />
              <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                Your tenant API key for authentication.
              </div>
            </div>
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.5rem' }}>
              <button 
                className="btn btn-primary"
                onClick={handleSaveApi}
                disabled={isSaved}
              >
                {isSaved ? (
                  <>Saving...</>
                ) : (
                  <><PlusIcon width={16} height={16} /> Save & Reload</>
                )}
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="card" style={{ maxWidth: '600px' }}>
          <div className="card-header" style={{ marginBottom: '1.5rem', fontSize: 'var(--text-lg)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DashboardIcon width={20} height={20} className="text-accent" /> Appearance
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {[
              { id: 'system', label: 'System', icon: DashboardIcon },
              { id: 'light', label: 'Light', icon: SunIcon },
              { id: 'dark', label: 'Dark', icon: MoonIcon }
            ].map((t) => {
              const Icon = t.icon;
              const isActive = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleThemeChange(t.id as any)}
                  className={clsx('btn', isActive ? 'btn-primary' : 'btn-secondary')}
                  style={{ 
                    flex: 1, 
                    minWidth: '120px', 
                    padding: '1rem', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)'
                  }}
                >
                  <Icon width={24} height={24} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};
