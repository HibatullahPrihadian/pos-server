import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

const STYLES = {
  success: { bg: 'bg-ios-green/15 border-ios-green/40 text-ios-green', Icon: CheckCircle2 },
  error: { bg: 'bg-ios-red/15 border-ios-red/40 text-ios-red', Icon: XCircle },
  warning: { bg: 'bg-ios-orange/15 border-ios-orange/40 text-ios-orange', Icon: AlertTriangle },
  info: { bg: 'bg-ios-blue/15 border-ios-blue/40 text-ios-blue', Icon: CheckCircle2 },
};

const Toast = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const { bg, Icon } = STYLES[toast.type] || STYLES.info;
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-ios-sm border backdrop-blur-glass animate-fade-in ${bg}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <span className="text-sm flex-1">{toast.message}</span>
            <button onClick={() => onDismiss(toast.id)} className="p-0.5 hover:bg-white/10 rounded">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default Toast;
