import React from 'react';
import { useRecentActivity } from '@/hooks/useRecentActivity';
import { Activity, ShoppingCart, CheckCircle2, Utensils, DollarSign } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const RecentActivityWidget: React.FC = () => {
  const { activities } = useRecentActivity();

  if (activities.length === 0) {
    return (
      <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-6">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4">
          <Activity size={16} className="text-slate-400" />
          Recent Activity
        </h2>
        <div className="text-center py-6 text-slate-400 text-sm">
          No recent activity found.
        </div>
      </div>
    );
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'transaction':
        return <DollarSign size={14} className="text-emerald-600" />;
      case 'shopping':
        return <ShoppingCart size={14} className="text-blue-600" />;
      case 'todo':
        return <CheckCircle2 size={14} className="text-purple-600" />;
      case 'meal':
        return <Utensils size={14} className="text-orange-600" />;
      default:
        return <Activity size={14} className="text-slate-600" />;
    }
  };

  const getIconBg = (type: string) => {
    switch (type) {
      case 'transaction':
        return 'bg-emerald-50 border-emerald-100';
      case 'shopping':
        return 'bg-blue-50 border-blue-100';
      case 'todo':
        return 'bg-purple-50 border-purple-100';
      case 'meal':
        return 'bg-orange-50 border-orange-100';
      default:
        return 'bg-slate-50 border-slate-100';
    }
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Activity size={16} className="text-brand-500" />
          Recent Activity
        </h2>
      </div>

      <div className="space-y-4 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
        {activities.map((item) => (
          <div key={`${item.type}-${item.id}`} className="flex items-center gap-3 group">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center border shrink-0 ${getIconBg(item.type)}`}>
              {getIcon(item.type)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <p className="text-sm font-bold text-slate-900 truncate pr-2">
                  {item.title}
                </p>
                <span className="text-xxs text-slate-400 whitespace-nowrap tabular-nums">
                  {formatDistanceToNow(item.timestamp, { addSuffix: true }).replace('about ', '')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-slate-500 truncate">
                  {item.subtitle}
                </p>
                {item.user && (
                   <div className="flex items-center gap-1 shrink-0 ml-2" title={item.user.displayName}>
                     {item.user.photoURL ? (
                       <img src={item.user.photoURL} alt={item.user.displayName} className="w-4 h-4 rounded-full" />
                     ) : (
                       <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-xxxs font-bold text-slate-500">
                         {item.user.displayName[0]}
                       </div>
                     )}
                   </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentActivityWidget;
