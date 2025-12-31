import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, ResponsiveContainer } from 'recharts';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ isOpen, onClose }) => {
  const { habits } = useHousehold();
  const [activeTab, setActiveTab] = useState<'week' | 'lifetime'>('week');

  if (!isOpen) return null;

  // --- MOCK DATA PREPARATION ---
  
  // Tab 1: Sentiment Pie
  const positiveCount = habits.filter(h => h.type === 'positive').length;
  const negativeCount = habits.filter(h => h.type === 'negative').length;
  const sentimentData = [
    { name: 'Positive', value: positiveCount, color: '#10B981' },
    { name: 'Negative', value: negativeCount, color: '#F43F5E' },
  ];

  // Tab 1: Frequency Bar (Top 5)
  const frequencyData = [...habits]
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 5)
    .map(h => ({
      name: h.title.split(' ')[0], // truncate for chart
      count: h.totalCount
    }));

  // Tab 2: Lifetime Trend (Mocked)
  const trendData = [
    { week: 'W1', points: 420 },
    { week: 'W2', points: 580 },
    { week: 'W3', points: 550 },
    { week: 'W4', points: 890 },
    { week: 'W5', points: 1200 },
  ];

  // Tab 2: Day of Week (Mocked)
  const dayData = [
    { day: 'Mon', avg: 120 },
    { day: 'Tue', avg: 145 },
    { day: 'Wed', avg: 100 },
    { day: 'Thu', avg: 180 },
    { day: 'Fri', avg: 90 },
    { day: 'Sat', avg: 210 },
    { day: 'Sun', avg: 250 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-h-[90vh] max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100">
          <h2 className="text-xl font-bold text-brand-800">Analytics</h2>
          <button onClick={onClose} className="p-2 bg-brand-50 rounded-full hover:bg-brand-100">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex p-2 bg-brand-50 mx-6 mt-4 rounded-xl">
          <button 
            onClick={() => setActiveTab('week')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'week' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'}`}
          >
            Week View
          </button>
          <button 
            onClick={() => setActiveTab('lifetime')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'lifetime' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'}`}
          >
            Lifetime
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {activeTab === 'week' ? (
            <>
              {/* Chart A: Sentiment */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Habit Breakdown</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sentimentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {sentimentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-2">
                  {sentimentData.map(d => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-xs font-bold text-brand-600">{d.name} ({d.value})</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chart B: Frequency */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Top Habits</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={frequencyData} margin={{ left: 10 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={60} tick={{fontSize: 12}} />
                      <Tooltip cursor={{fill: 'transparent'}} />
                      <Bar dataKey="count" fill="#1E293B" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Chart C: Trend */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Points Trend</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <XAxis dataKey="week" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip />
                      <Line type="monotone" dataKey="points" stroke="#FBBF24" strokeWidth={3} dot={{r: 4, fill: '#FBBF24'}} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart D: Day of Week */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Best Performing Days</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dayData}>
                      <XAxis dataKey="day" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{fill: '#F1F5F9'}} />
                      <Bar dataKey="avg" fill="#475569" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default AnalyticsModal;