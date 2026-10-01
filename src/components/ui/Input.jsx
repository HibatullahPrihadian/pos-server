const Input = ({ label, error, className = '', as = 'input', children, ...props }) => {
  const baseClass =
    'w-full bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ios-blue/60 focus:ring-2 focus:ring-ios-blue/25 transition-colors';

  return (
    <label className={`block ${className}`}>
      {label && <span className="block mb-1.5 text-xs font-medium text-slate-400">{label}</span>}
      {as === 'select' ? (
        <select className={baseClass} {...props}>
          {children}
        </select>
      ) : as === 'textarea' ? (
        <textarea className={baseClass} rows={3} {...props} />
      ) : (
        <input className={baseClass} {...props} />
      )}
      {error && <span className="block mt-1 text-xs text-ios-red">{error}</span>}
    </label>
  );
};

export default Input;
