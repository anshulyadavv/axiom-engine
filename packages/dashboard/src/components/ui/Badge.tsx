import React from 'react';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  withDot?: boolean;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  withDot = true,
  dot,
  className = '',
  ...props
}) => {
  const showDot = dot !== undefined ? dot : withDot;
  return (
    <span className={`badge badge-${variant} ${className}`} {...props}>
      {showDot && <span className="badge-dot" />}
      {children}
    </span>
  );
};
