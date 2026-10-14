import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  icon,
  badge,
  action,
  interactive = false,
  children,
  className = '',
  style,
  ...props
}) => {
  const hasHeader = title || action || badge;

  return (
    <div
      className={`card ${interactive ? 'interactive' : ''} ${className}`}
      style={style}
      {...props}
    >
      {hasHeader && (
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {icon && <span style={{ color: 'var(--accent)' }}>{icon}</span>}
            {title && <span className="card-title">{title}</span>}
            {badge}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
