import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { calculateForecast, SimulatedTransaction } from '../../utils/forecasting/forecastCalculator';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, parseISO } from 'date-fns';
import { Plus, X, AlertTriangle, TrendingUp, Info } from 'lucide-react';
import toast from 'react-hot-toast';

const BudgetForecast: React.FC = () => {
  const { accounts, calendarItems } = useHousehold();
  const [simulations, setSimulations] = useState<SimulatedTransaction[]>([]);

  // Simulator Form State
  const [simAmount, setSimAmount] = useState('');
  const [simTitle, setSimTitle] = useState('');
  const [simDate, setSimDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const forecastData = useMemo(() => {
    return calculateForecast(accounts, calendarItems, new Date(), 30, simulations);
  }, [accounts, calendarItems, simulations]);

  const minBalance = Math.min(...forecastData.map(d => d.minBalance));
  const willGoNegative = minBalance < 0;
  const lowestPoint = forecastData.reduce((min, curr) => curr.minBalance < min.minBalance ? curr : min, forecastData[0]);

  const handleAddSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simAmount || !simTitle || !simDate) return;

    const newSim: SimulatedTransaction = {
      id: crypto.randomUUID(),
      title: simTitle,
      amount: parseFloat(simAmount),
      date: simDate,
      type: 'expense'
    };

    setSimulations([...simulations, newSim]);
    setSimAmount('');
    setSimTitle('');
    toast.success('Scenario added to forecast');
  };

  const removeSimulation = (id: string) => {
    setSimulations(simulations.filter(s => s.id !== id));
  };

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-brand-100 shadow-lg rounded-xl text-sm">
          <p className="font-bold text-brand-800 mb-1">{format(parseISO(data.date), 'MMM d, yyyy')}</p>
          <p className={`font-mono font-bold ${data.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
            Balance: ${data.balance.toLocaleString()}
          </p>
          {data.events.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
              {data.events.map((e: any, i: number) => (
                <div key={i} className="flex justify-between gap-4 text-xs">
                  <span className={e.type === 'simulation' ? 'text-purple-600 font-bold' : 'text-gray-600'}>
                    {e.type === 'income' ? '+' : '-'}{e.title}
                  </span>
                  <span className="font-mono">${e.amount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Chart Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-brand-100 p-4 h-[400px]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-brand-800 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-brand-600" />
            30-Day Projection
          </h3>
          {willGoNegative && (
             <div className="flex items-center gap-2 px-3 py-1 bg-red-50 text-red-700 text-xs font-bold rounded-full border border-red-200">
               <AlertTriangle size={14} />
               Risk: -${Math.abs(lowestPoint.minBalance).toLocaleString()} on {format(parseISO(lowestPoint.date), 'MMM d')}
             </div>
          )}
        </div>

        <ResponsiveContainer width="100%" height="90%">
          <AreaChart data={forecastData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={willGoNegative ? "#EF4444" : "#10B981"} stopOpacity={0.2}/>
                <stop offset="95%" stopColor={willGoNegative ? "#EF4444" : "#10B981"} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              tickFormatter={(str) => format(parseISO(str), 'd')}
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val) => `$${val}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={willGoNegative ? "#EF4444" : "#10B981"}
              fillOpacity={1}
              fill="url(#colorBalance)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Simulator Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-brand-100 p-6">
        <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600">
                <Plus size={20} />
            </div>
            <div>
                <h3 className="font-bold text-brand-800">Simulator</h3>
                <p className="text-xs text-brand-400">Test "What If" scenarios</p>
            </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleAddSimulation} className="flex flex-col sm:flex-row gap-3 mb-6">
            <input
                type="text"
                placeholder="Expense Name (e.g. New TV)"
                value={simTitle}
                onChange={e => setSimTitle(e.target.value)}
                className="flex-1 p-3 bg-brand-50 border border-brand-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none"
            />
            <div className="flex gap-3">
                <input
                    type="number"
                    placeholder="Amount"
                    value={simAmount}
                    onChange={e => setSimAmount(e.target.value)}
                    className="w-24 p-3 bg-brand-50 border border-brand-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <input
                    type="date"
                    value={simDate}
                    onChange={e => setSimDate(e.target.value)}
                    className="w-32 p-3 bg-brand-50 border border-brand-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <button
                    type="submit"
                    disabled={!simAmount || !simTitle}
                    className="p-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus size={20} />
                </button>
            </div>
        </form>

        {/* Active Simulations */}
        {simulations.length > 0 && (
            <div className="space-y-2">
                <p className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-2">Active Scenarios</p>
                {simulations.map(sim => (
                    <div key={sim.id} className="flex items-center justify-between p-3 bg-purple-50 rounded-xl border border-purple-100">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-purple-900">{sim.title}</span>
                            <span className="text-xs text-purple-500 bg-white px-2 py-0.5 rounded-full border border-purple-100">{sim.date}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-purple-700">-${sim.amount}</span>
                            <button
                                onClick={() => removeSimulation(sim.id)}
                                className="p-1 text-purple-400 hover:text-purple-700 rounded-full hover:bg-purple-100 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {simulations.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-brand-400 p-3 bg-brand-50 rounded-xl border border-dashed border-brand-200">
                <Info size={16} />
                <span>Add an expense above to see how it affects your future balance.</span>
            </div>
        )}
      </div>
    </div>
  );
};

export default BudgetForecast;
