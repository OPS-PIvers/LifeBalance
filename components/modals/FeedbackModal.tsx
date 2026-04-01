import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import Textarea from '@/components/ui/Textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
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
  const { householdId } = useHousehold();
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
          <Textarea
            id="feedback-message"
            label="Describe the issue or suggestion"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="h-32"
            placeholder="I found a bug when..."
            required
          />
        </div>
        <div className="flex justify-end pt-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !message.trim()}
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors font-bold"
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
