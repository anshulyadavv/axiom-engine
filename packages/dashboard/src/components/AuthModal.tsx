import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type UserInfo } from '../api';
import { 
  LockClosedIcon, 
  PersonIcon, 
  ExitIcon, 
  Cross2Icon, 
  CheckCircledIcon, 
  ExclamationTriangleIcon,
  ReloadIcon 
} from '@radix-ui/react-icons';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const queryClient = useQueryClient();
  const [isBootstrap, setIsBootstrap] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { data: user, refetch: refetchUser } = useQuery<UserInfo | null>({
    queryKey: ['auth_me'],
    queryFn: api.getMe,
  });

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset state on open/close
  useEffect(() => {
    if (!isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen]);

  const loginMutation = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: () => {
      setSuccessMsg('Authenticated successfully');
      setErrorMsg(null);
      refetchUser();
      queryClient.invalidateQueries();
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 700);
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Login failed: please check your credentials');
      setSuccessMsg(null);
    }
  });

  const bootstrapMutation = useMutation({
    mutationFn: () => api.bootstrapAdmin(email, password, bootstrapSecret || undefined),
    onSuccess: () => {
      setSuccessMsg('Administrator account initialized and authenticated!');
      setErrorMsg(null);
      refetchUser();
      queryClient.invalidateQueries();
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 800);
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Bootstrap failed');
      setSuccessMsg(null);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      refetchUser();
      queryClient.invalidateQueries();
      onClose();
    }
  });

  if (!isOpen) return null;

  const isPending = loginMutation.isPending || bootstrapMutation.isPending || logoutMutation.isPending;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="auth-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="auth-modal"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="modal-content"
            style={{ maxWidth: '440px' }}
          >
            {/* Header */}
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '8px', 
                  backgroundColor: 'var(--accent-muted)' 
                }}>
                  <LockClosedIcon width={18} height={18} color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {user ? 'Account Session' : isBootstrap ? 'Bootstrap First Admin' : 'Sign In to Axiom'}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 400 }}>
                    {user ? 'Authenticated control plane' : isBootstrap ? 'Create the primary admin account' : 'Production workflow orchestration'}
                  </div>
                </div>
              </div>
              <button 
                className="btn btn-ghost" 
                style={{ padding: '6px', borderRadius: '6px' }} 
                onClick={onClose}
                aria-label="Close modal"
              >
                <Cross2Icon width={16} height={16} />
              </button>
            </div>

            {/* Body */}
            <div className="modal-body" style={{ padding: '1.5rem' }}>
              {user ? (
                <div>
                  <div style={{ 
                    background: 'var(--bg-tertiary)', 
                    border: '1px solid var(--border-subtle)', 
                    borderRadius: '10px', 
                    padding: '1.25rem', 
                    marginBottom: '1.5rem' 
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ 
                        width: '36px', 
                        height: '36px', 
                        borderRadius: '50%', 
                        background: 'var(--accent)', 
                        color: '#fff', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: '14px'
                      }}>
                        {user.email.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all', fontSize: 'var(--text-sm)' }}>
                          {user.email}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2px' }}>
                          <span className={`badge ${user.role === 'admin' ? 'badge-primary' : 'badge-secondary'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                            {user.role.toUpperCase()}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                            Tenant: {user.tenant_id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ 
                      fontSize: '11px', 
                      color: 'var(--text-secondary)', 
                      borderTop: '1px solid var(--border-subtle)', 
                      paddingTop: '0.75rem',
                      lineHeight: '1.4'
                    }}>
                      Protected with Argon2id password hashing, HttpOnly session cookie, and CSRF token verification.
                    </div>
                  </div>

                  <button 
                    className="btn btn-secondary"
                    style={{ 
                      width: '100%', 
                      height: '40px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '0.5rem', 
                      color: 'var(--error)' 
                    }}
                    onClick={() => logoutMutation.mutate()}
                    disabled={isPending}
                  >
                    {logoutMutation.isPending ? <ReloadIcon className="animate-spin" width={14} height={14} /> : <ExitIcon width={14} height={14} />}
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <div>
                  {errorMsg && (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'flex-start', 
                      gap: '0.5rem', 
                      padding: '0.75rem 1rem', 
                      background: 'rgba(239, 68, 68, 0.1)', 
                      border: '1px solid var(--error-border)', 
                      borderRadius: '8px', 
                      color: 'var(--error)', 
                      fontSize: 'var(--text-xs)', 
                      marginBottom: '1.25rem' 
                    }}>
                      <ExclamationTriangleIcon width={16} height={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div style={{ flex: 1 }}>{errorMsg}</div>
                    </div>
                  )}

                  {successMsg && (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem', 
                      padding: '0.75rem 1rem', 
                      background: 'rgba(34, 197, 94, 0.1)', 
                      border: '1px solid var(--success-border)', 
                      borderRadius: '8px', 
                      color: 'var(--success)', 
                      fontSize: 'var(--text-xs)', 
                      marginBottom: '1.25rem' 
                    }}>
                      <CheckCircledIcon width={16} height={16} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>{successMsg}</div>
                    </div>
                  )}

                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (isBootstrap) bootstrapMutation.mutate();
                    else loginMutation.mutate();
                  }}>
                    <div style={{ marginBottom: '1rem' }}>
                      <label htmlFor="auth-email">Email Address</label>
                      <input 
                        id="auth-email"
                        type="email" 
                        value={email} 
                        onChange={e => setEmail(e.target.value)} 
                        required 
                        autoFocus
                        placeholder="admin@axiom.local"
                      />
                    </div>

                    <div style={{ marginBottom: isBootstrap ? '1rem' : '1.25rem' }}>
                      <label htmlFor="auth-password">Password</label>
                      <input 
                        id="auth-password"
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        required 
                        placeholder={isBootstrap ? "At least 8 characters" : "••••••••••••"}
                      />
                    </div>

                    {isBootstrap && (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <label htmlFor="auth-secret" style={{ margin: 0 }}>Bootstrap Secret</label>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>(Optional)</span>
                        </div>
                        <input 
                          id="auth-secret"
                          type="password" 
                          value={bootstrapSecret} 
                          onChange={e => setBootstrapSecret(e.target.value)} 
                          placeholder="Leave empty if none set in environment"
                        />
                      </div>
                    )}

                    <button 
                      type="submit" 
                      className="btn btn-primary"
                      style={{ 
                        width: '100%', 
                        height: '42px', 
                        fontSize: 'var(--text-sm)', 
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem'
                      }}
                      disabled={isPending}
                    >
                      {isPending ? (
                        <>
                          <ReloadIcon className="animate-spin" width={16} height={16} />
                          <span>{isBootstrap ? 'Initializing...' : 'Signing In...'}</span>
                        </>
                      ) : (
                        <span>{isBootstrap ? 'Initialize Administrator' : 'Sign In'}</span>
                      )}
                    </button>
                  </form>

                  <div style={{ marginTop: '1.25rem', textAlign: 'center' }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      style={{ 
                        fontSize: 'var(--text-xs)', 
                        color: 'var(--accent)',
                        fontWeight: 500,
                        padding: '0.25rem 0.5rem'
                      }}
                      onClick={() => { 
                        setIsBootstrap(!isBootstrap); 
                        setErrorMsg(null); 
                      }}
                    >
                      {isBootstrap ? 'Already initialized? Sign In' : 'First time? Bootstrap First Admin'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
};
