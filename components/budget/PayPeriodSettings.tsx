import React, { useState } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { getCurrentPayPeriod } from '../../utils/payPeriodCalculator';
import { format, parseISO } from 'date-fns';
import { Calendar, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

const PayPeriodSettings: React.FC = () => {
  const {
    householdSettings,
    setPayPeriodStartDate,
    manuallyResetPeriod,
    currentPeriodId,
  } = useHousehold();

  const [startDate, setStartDate] = useState(householdSettings?.startDate || '');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleSave = async () => {
    if (!startDate) {
      toast.error('Please select a start date');
      return;
    }

    await setPayPeriodStartDate(startDate);
  };

  const handleReset = async () => {
    await manuallyResetPeriod();
    setShowResetConfirm(false);
  };

  const currentPeriod = householdSettings?.startDate
    ? getCurrentPayPeriod(householdSettings.startDate)
    : null;

  return (
    <div className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Calendar size={20} className="text-brand-600" />
        <h3 className="font-bold text-brand-800">Pay Period Settings</h3>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-brand-400 uppercase block mb-2">
            First Pay Period Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors font-mono text-sm"
          />
          <p className="text-xs text-brand-400 mt-2">
            Enter the first day of any bi-weekly pay period. All future periods will be calculated from this date.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={!startDate || startDate === householdSettings?.startDate}
          className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-900 transition-colors"
        >
          Save Pay Period Settings
        </button>

        {currentPeriod && householdSettings?.startDate && (
          <div className="pt-4 border-t border-brand-100 space-y-3">
            <div className="bg-brand-50 p-3 rounded-xl">
              <p className="text-xs font-bold text-brand-400 uppercase mb-1">Current Period</p>
              <p className="text-sm text-brand-800 font-mono">
                {format(parseISO(currentPeriod.startDate), 'MMM d, yyyy')} - {format(parseISO(currentPeriod.endDate), 'MMM d, yyyy')}
              </p>
              <p className="text-xs text-brand-400 mt-1">
                Period ID: {currentPeriod.periodId}
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-800 mb-2">Adjust for Early/Late Paycheck</p>
              <p className="text-xs text-amber-600 mb-3">
                If your paycheck hits early (holidays/weekends), shift the period dates:
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const currentStart = parseISO(householdSettings.startDate);
                    const newStart = format(new Date(currentStart.getTime() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
                    setStartDate(newStart);
                    setPayPeriodStartDate(newStart);
                  }}
                  className="flex-1 py-2 bg-white text-amber-800 font-medium text-sm rounded-lg border border-amber-300 hover:bg-amber-100 transition-colors"
                >
                  -1 Day
                </button>
                <button
                  onClick={() => {
                    const currentStart = parseISO(householdSettings.startDate);
                    const newStart = format(new Date(currentStart.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
                    setStartDate(newStart);
                    setPayPeriodStartDate(newStart);
                  }}
                  className="flex-1 py-2 bg-white text-amber-800 font-medium text-sm rounded-lg border border-amber-300 hover:bg-amber-100 transition-colors"
                >
                  +1 Day
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-full py-2 text-brand-600 hover:text-brand-800 font-medium text-sm flex items-center justify-center gap-2 hover:bg-brand-50 rounded-lg transition-colors"
            >
              <RotateCcw size={16} />
              Manually Reset Period
            </button>
          </div>
        )}
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl max-w-sm w-full shadow-xl animate-in zoom-in-95 duration-200">
            <h4 className="font-bold text-brand-800 mb-2 text-lg">Reset Pay Period?</h4>
            <p className="text-sm text-brand-600 mb-4">
              This will archive current bucket data for the period ending today and reset all buckets for a new period starting tomorrow.
            </p>
            <p className="text-xs text-amber-600 mb-4 bg-amber-50 p-3 rounded-lg border border-amber-200">
              <strong>Warning:</strong> This action cannot be undone. Only use this if you need to manually force a period reset.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 transition-colors"
              >
                Reset Period
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayPeriodSettings;
