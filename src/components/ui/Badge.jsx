const Badge = ({ children, tone = 'neutral', className = '' }) => {
  const tones = {
    neutral: 'bg-white/10 text-slate-300 border-white/10',
    blue: 'bg-ios-blue/15 text-ios-blue border-ios-blue/30',
    green: 'bg-ios-green/15 text-ios-green border-ios-green/30',
    red: 'bg-ios-red/15 text-ios-red border-ios-red/30',
    orange: 'bg-ios-orange/15 text-ios-orange border-ios-orange/30',
    purple: 'bg-ios-purple/15 text-ios-purple border-ios-purple/30',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tones[tone] || tones.neutral} ${className}`}
    >
      {children}
    </span>
  );
};

export default Badge;
