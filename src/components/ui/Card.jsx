const Card = ({ title, action, children, className = '', bodyClassName = '', padded = true }) => (
  <div className={`bg-slate-900/65 backdrop-blur-glass border border-white/10 rounded-ios shadow-glass ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        {title && <h3 className="font-semibold text-white">{title}</h3>}
        {action}
      </div>
    )}
    <div className={`${padded ? 'p-5' : ''} ${bodyClassName}`}>{children}</div>
  </div>
);

export default Card;
