import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div
      style={{
        padding: '3rem 1.5rem',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.625rem',
      }}
    >
      {icon && (
        <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem', opacity: 0.8 }}>
          {icon}
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--text-primary)' }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: '0.75rem' }}>{action}</div>}
    </div>
  );
};
