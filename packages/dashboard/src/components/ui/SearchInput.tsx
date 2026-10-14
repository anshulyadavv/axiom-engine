import React from 'react';
import { Search, X } from 'lucide-react';

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  shortcut?: string;
  onClear?: () => void;
  fullWidth?: boolean;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search...',
  shortcut,
  fullWidth = false,
  className = '',
  style,
  ...props
}) => {
  return (
    <div
      className={`search-container ${fullWidth ? 'page-search-container' : ''} ${className}`}
      style={style}
    >
      <Search size={14} className="search-icon" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="search-input"
        {...props}
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={12} />
        </button>
      )}
      {shortcut && !value && (
        <span
          className="search-shortcut"
          style={{
            fontSize: '10px',
            padding: '1px 5px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            marginLeft: '0.25rem',
          }}
        >
          {shortcut}
        </span>
      )}
    </div>
  );
};
