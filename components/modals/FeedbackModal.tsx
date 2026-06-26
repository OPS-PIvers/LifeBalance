import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { useAuth } from '@/contexts/AuthContext';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { db } from '@/firebase.config';
import { collection, addDoc } from 'firebase/firestore';
import { FeedbackReport } from '@/types/schema';
import toast from 'react-hot-toast';
import { Loader2, Send } from 'lucide-react';
import { useLocation } from 'react-router-dom';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const APP_VERSION = '0.8.0-alpha';

const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { householdId } = useHouseholdCore();
  const location = useLocation();
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsSubmitting(true);
    try {
      const report: Omit<FeedbackReport, 'id'> = {
        userId: user?.uid || 'anonymous',
        householdId: householdId || 'unknown',
        message: message.trim(),
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        route: location.pathname,
        errorContext: navigator.userAgent // Simple context
      };

      await addDoc(collection(db, 'feedback'), report);
      toast.success("Feedback sent! Thank you.");
      setMessage('');
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Failed to send feedback.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Send Feedback">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="feedback-message" className="block text-sm font-medium text-brand-700 dark:text-brand-200">
            Describe the issue or suggestion
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full h-32 p-3 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 text-brand-900 dark:text-brand-100 placeholder:text-brand-400 dark:placeholder:text-brand-500 rounded-btn focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 outline-hidden transition-all duration-(--duration-fast) ease-(--ease-standard) resize-none"
            placeholder="I found a bug when..."
            required
          />
        </div>
        <div className="flex justify-end pt-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-brand-600 dark:text-brand-300 font-medium hover:bg-brand-100 dark:hover:bg-brand-700/50 rounded-btn transition-colors duration-(--duration-fast) ease-(--ease-standard)"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !message.trim()}
            className="flex items-center gap-2 bg-accent-600 dark:bg-accent-500 text-white px-4 py-2 rounded-btn hover:bg-accent-700 dark:hover:bg-accent-400 disabled:opacity-50 transition-colors duration-(--duration-fast) ease-(--ease-standard) font-semibold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Report
          </button>
        </div>
      </form>
    </Drawer>
  );
};

export default FeedbackModal;
