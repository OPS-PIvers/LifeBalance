import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { InsightAction } from '@/types/schema';
import toast from 'react-hot-toast';

export const useInsightActions = () => {
  const {
    updateBucketLimit,
    addHabit,
    addToDo,
    buckets,
    currentUser
  } = useHousehold();

  const handleAction = async (action: InsightAction) => {
    try {
      if (!action.payload) {
        toast.error("Invalid action data.");
        return;
      }

      if (action.type === 'update_bucket') {
        const payload = action.payload;
        if (!payload.bucketName || typeof payload.newLimit !== 'number') {
           toast.error("Missing bucket information.");
           return;
        }

        const bucketName = payload.bucketName;
        const newLimit = payload.newLimit;

        const bucket = buckets.find(b => b.name.toLowerCase() === bucketName.toLowerCase());

        if (!bucket) {
          toast.error(`Bucket "${bucketName}" not found.`);
          return;
        }

        await updateBucketLimit(bucket.id, newLimit);
        // Toast handled by context
      }
      else if (action.type === 'create_habit') {
        const payload = action.payload;
        if (!payload.title || !payload.category) {
            toast.error("Missing habit details.");
            return;
        }

        // Construct a safe default habit
        await addHabit({
          id: '', // Firestore will generate
          title: payload.title,
          category: payload.category,
          type: payload.type || 'positive',
          period: payload.period || 'daily',
          basePoints: 10,
          scoringType: 'threshold',
          targetCount: 1,
          count: 0,
          totalCount: 0,
          completedDates: [],
          streakDays: 0,
          lastUpdated: new Date().toISOString(),
          weatherSensitive: false // Set default to false as required by schema
        });
        // Toast handled by context
      }
      else if (action.type === 'create_todo') {
        const payload = action.payload;
        if (!payload.text) {
            toast.error("Missing task description.");
            return;
        }

        await addToDo({
          text: payload.text,
          completeByDate: payload.completeByDate || new Date().toISOString().split('T')[0],
          assignedTo: currentUser?.uid || '',
          isCompleted: false
        });
        toast.success('Added to To-Do List');
      }
    } catch (e: unknown) {
      console.error("Action execution failed:", e);
      let userMessage = "Failed to execute action.";

      // Differentiate common error types where possible
      if (e && typeof e === 'object' && 'code' in e) {
        const code = (e as { code?: string }).code;
        switch (code) {
          case 'permission-denied':
            userMessage = "You don't have permission to perform this action.";
            break;
          case 'unavailable':
            userMessage = "The service is currently unavailable. Please check your connection and try again.";
            break;
          default:
            break;
        }
      } else if (e instanceof Error && e.message) {
        userMessage = "Failed to execute action: " + e.message;
      }
      toast.error(userMessage);
    }
  };

  return { handleAction };
};
