import React from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Sparkles, History, Wand2, ArrowRight, Wallet, CheckCircle2, Plus } from 'lucide-react';
import { InsightAction } from '@/types/schema';
import toast from 'react-hot-toast';

interface InsightWidgetProps {
  onOpenArchive: () => void;
}

export const InsightWidget: React.FC<InsightWidgetProps> = ({ onOpenArchive }) => {
  const {
    insight,
    refreshInsight,
    isGeneratingInsight,
    insightsHistory,
    updateBucketLimit,
    addHabit,
    addToDo,
    buckets,
    currentUser
  } = useHousehold();

  // Get actions from the latest insight if it matches the current display text
  // The context updates `insight` (string) and `insightsHistory` (array) simultaneously from Firestore
  const latestInsight = insightsHistory.length > 0 ? insightsHistory[0] : null;
  const actions = (latestInsight && latestInsight.text === insight) ? latestInsight.actions : [];

  const handleAction = async (action: InsightAction) => {
    try {
      if (!action.payload) {
        toast.error("Invalid action data.");
        return;
      }

      if (action.type === 'update_bucket') {
        const bucketName = action.payload?.bucketName;
        const newLimit = action.payload?.newLimit;

        if (!bucketName || typeof newLimit !== 'number') {
           toast.error("Missing bucket information.");
           return;
        }

        const bucket = buckets.find(b => b.name.toLowerCase() === bucketName.toLowerCase());

        if (!bucket) {
          toast.error(`Bucket "${bucketName}" not found.`);
          return;
        }

        await updateBucketLimit(bucket.id, newLimit);
        // Toast handled by context
      }
      else if (action.type === 'create_habit') {
        const title = action.payload?.title;
        const category = action.payload?.category;

        if (!title || !category) {
            toast.error("Missing habit details.");
            return;
        }

        const { type, period } = action.payload;
        // Construct a safe default habit
        await addHabit({
          id: '', // Firestore will generate
          title,
          category,
          type: type || 'positive',
          period: period || 'daily',
          basePoints: 10,
          scoringType: 'threshold',
          targetCount: 1,
          count: 0,
          totalCount: 0,
          completedDates: [],
          streakDays: 0,
          lastUpdated: new Date().toISOString()
        });
        // Toast handled by context
      }
      else if (action.type === 'create_todo') {
        const text = action.payload?.text;

        if (!text) {
            toast.error("Missing task description.");
            return;
        }

        const { completeByDate } = action.payload;
        await addToDo({
          text,
          completeByDate: completeByDate || new Date().toISOString().split('T')[0],
          assignedTo: currentUser?.uid || '',
          isCompleted: false
        });
        toast.success('Added to To-Do List');
      }
    } catch (e) {
      console.error("Action execution failed:", e);
      toast.error("Failed to execute action.");
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'update_bucket': return <Wallet size={14} />;
      case 'create_habit': return <Plus size={14} />;
      case 'create_todo': return <CheckCircle2 size={14} />;
      default: return <ArrowRight size={14} />;
    }
  };

  return (
    <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-100 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-white rounded-xl shadow-sm text-indigo-500">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">AI Insight</h3>
            <div className="flex gap-2">
              <button
                onClick={onOpenArchive}
                className="flex items-center gap-1.5 px-3 py-1 bg-white text-indigo-600 rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-indigo-50"
              >
                <History size={12} />
                History
              </button>
              <button
                onClick={refreshInsight}
                disabled={isGeneratingInsight}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Wand2 size={12} />
                {isGeneratingInsight ? 'Generating...' : 'Get Insight'}
              </button>
            </div>
          </div>
          <p className="text-indigo-900 font-medium leading-relaxed mb-3">
            &quot;{insight}&quot;
          </p>

          {/* Action Pills */}
          {actions && actions.length > 0 && (
            <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAction(action)}
                  className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold border border-indigo-100 shadow-sm active:scale-95 transition-all"
                >
                  {getActionIcon(action.type)}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
