import React from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  badge,
  actions,
}) => {
  return (
    <div className="page-header">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <h1 className="page-header-title">{title}</h1>
          {badge}
        </div>
        {description && <p className="page-header-desc">{description}</p>}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {actions}
        </div>
      )}
    </div>
  );
};
