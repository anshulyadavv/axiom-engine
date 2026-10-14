import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  isLoading = false,
  icon,
  iconRight,
  disabled,
  className = '',
  style,
  ...props
}) => {
  const getVariantClass = () => {
    switch (variant) {
      case 'primary': return 'btn-primary';
      case 'danger': return 'btn-danger';
      case 'ghost': return 'btn-ghost';
      case 'secondary':
      default: return 'btn-secondary';
    }
  };

  const getSizeClass = () => {
    switch (size) {
      case 'sm': return 'btn-sm';
      case 'lg': return 'btn-lg';
      case 'md':
      default: return 'btn-md';
    }
  };

  return (
    <button
      className={`btn ${getVariantClass()} ${getSizeClass()} ${className}`}
      disabled={disabled || isLoading}
      style={style}
      {...props}
    >
      {isLoading ? (
        <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" />
      ) : (
        icon && <span className="btn-icon">{icon}</span>
      )}
      {children && <span>{children}</span>}
      {!isLoading && iconRight && <span className="btn-icon-right">{iconRight}</span>}
    </button>
  );
};
