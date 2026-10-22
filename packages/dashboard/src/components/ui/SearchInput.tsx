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
          className="search-clear-btn"
          aria-label="Clear search"
        >
          <X size={12} />
        </button>
      )}
      {shortcut && !value && (
        <span className="search-shortcut">
          {shortcut}
        </span>
      )}
    </div>
  );
};
