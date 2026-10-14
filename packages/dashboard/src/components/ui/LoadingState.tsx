import React from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingStateProps {
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading data...',
}) => {
  return (
    <div
      style={{
        padding: '3.5rem 1.5rem',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        color: 'var(--text-muted)',
        fontSize: 'var(--font-size-sm)',
      }}
    >
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
      <span>{message}</span>
    </div>
  );
};
