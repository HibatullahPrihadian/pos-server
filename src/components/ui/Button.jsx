const VARIANTS = {
  primary: 'bg-ios-blue hover:bg-ios-blue/85 text-white shadow-glow-blue',
  success: 'bg-ios-green hover:bg-ios-green/85 text-slate-950 shadow-glow-green',
  danger: 'bg-ios-red hover:bg-ios-red/85 text-white shadow-glow-red',
  warning: 'bg-ios-orange hover:bg-ios-orange/85 text-slate-950 shadow-glow-orange',
  neutral: 'bg-white/10 hover:bg-white/15 text-white border border-white/10',
  ghost: 'hover:bg-white/10 text-slate-300 hover:text-white',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

import { forwardRef } from 'react';

const Button = forwardRef(({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  disabled = false,
  ...props
}, ref) => (
  <button
    ref={ref}
    type={type}
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-2 rounded-ios-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`}
    {...props}
  >
    {children}
  </button>
));

Button.displayName = 'Button';

export default Button;
