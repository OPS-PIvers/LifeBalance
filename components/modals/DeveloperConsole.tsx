import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/firebase.config';
import { collection, query, getDocs, addDoc, updateDoc, doc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { BetaTester, FeedbackReport, Household } from '@/types/schema';
import { Loader2, Plus, Trash2, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

interface DeveloperConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'testers' | 'ai_meter' | 'reports';

const DeveloperConsole: React.FC<DeveloperConsoleProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('testers');
  const [testers, setTesters] = useState<(BetaTester & { id: string })[]>([]);
  const [reports, setReports] = useState<(FeedbackReport & { id: string })[]>([]);
  const [households, setHouseholds] = useState<(Household & { id: string })[]>([]);
  const [loading, setLoading] = useState(false);

  // Tester Form
  const [newTesterEmail, setNewTesterEmail] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'testers') {
        const q = query(collection(db, 'beta_testers'), orderBy('addedAt', 'desc'));
        const snap = await getDocs(q);
        setTesters(snap.docs.map(d => ({ ...d.data(), id: d.id } as BetaTester & { id: string })));
      } else if (activeTab === 'reports') {
        const q = query(collection(db, 'feedback'), orderBy('timestamp', 'desc'), limit(50));
        const snap = await getDocs(q);
        setReports(snap.docs.map(d => ({ ...d.data(), id: d.id } as FeedbackReport & { id: string })));
      } else if (activeTab === 'ai_meter') {
        const q = query(collection(db, 'households'), limit(50)); // Limit to 50 for safety
        const snap = await getDocs(q);
        setHouseholds(snap.docs.map(d => ({ ...d.data(), id: d.id } as Household & { id: string })));
      }
    } catch (error) {
      console.error("Failed to load data", error);
      toast.error("Failed to load data (Check console)");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, activeTab, loadData]);

  const handleAddTester = async () => {
    if (!newTesterEmail) return;
    try {
      const newTester: Omit<BetaTester, 'id'> = {
        email: newTesterEmail,
        addedAt: new Date().toISOString(),
        status: 'active',
        usageLimit: 20
      };
      await addDoc(collection(db, 'beta_testers'), newTester);
      toast.success("Tester added");
      setNewTesterEmail('');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to add tester");
    }
  };

  const toggleTesterStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'revoked' : 'active';
    await updateDoc(doc(db, 'beta_testers', id), { status: newStatus });
    loadData();
  };

  const deleteTester = async (id: string) => {
    if(!confirm("Remove tester?")) return;
    await deleteDoc(doc(db, 'beta_testers', id));
    loadData();
  };

  const copyReport = (report: FeedbackReport) => {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast.success("Report JSON copied");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="dev-console-title" maxWidth="max-w-4xl">
      <div className="flex flex-col h-[70vh]">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
            <h2 id="dev-console-title" className="text-xl font-bold">Developer Console</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button
            onClick={() => setActiveTab('testers')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'testers' ? 'border-brand-600 text-brand-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Beta Testers
          </button>
          <button
            onClick={() => setActiveTab('ai_meter')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'ai_meter' ? 'border-brand-600 text-brand-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            AI Usage Meter
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'reports' ? 'border-brand-600 text-brand-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Feedback Reports
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'testers' && (
                <div className="space-y-6">
                  <div className="flex gap-2 p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <input
                      type="email"
                      placeholder="new@tester.com"
                      className="flex-1 p-2 border rounded-lg"
                      value={newTesterEmail}
                      onChange={e => setNewTesterEmail(e.target.value)}
                    />
                    <button onClick={handleAddTester} className="bg-brand-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-700">
                      <Plus size={16} /> Add Tester
                    </button>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-100 text-gray-600 font-medium">
                        <tr>
                          <th className="p-3">Email</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Added</th>
                          <th className="p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {testers.map(t => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="p-3 font-medium">{t.email}</td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-bold ${t.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {t.status}
                              </span>
                            </td>
                            <td className="p-3 text-gray-500">{new Date(t.addedAt).toLocaleDateString()}</td>
                            <td className="p-3 flex gap-2">
                              <button onClick={() => toggleTesterStatus(t.id, t.status)} className="text-blue-600 hover:underline text-xs font-bold">
                                {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                              </button>
                              <button onClick={() => deleteTester(t.id)} className="text-red-500 hover:bg-red-50 p-1 rounded ml-2">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'ai_meter' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                      <h3 className="text-sm font-medium text-blue-800">Total Active Households</h3>
                      <p className="text-3xl font-bold text-blue-900">{households.length}</p>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b font-medium text-gray-700">Household Usage (Daily)</div>
                    <div className="divide-y">
                        {households.map(h => {
                            const usage = h.aiUsage?.dailyCount || 0;
                            const percentage = Math.min((usage / 20) * 100, 100);
                            return (
                                <div key={h.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                    <div>
                                        <p className="font-bold text-gray-800">{h.name}</p>
                                        <p className="text-xs text-gray-400 font-mono">{h.id}</p>
                                        <p className="text-xs text-gray-500">Last Reset: {h.aiUsage?.lastResetDate || 'Never'}</p>
                                    </div>
                                    <div className="flex items-center gap-4 w-1/2">
                                        <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all ${percentage > 90 ? 'bg-red-500' : 'bg-brand-500'}`}
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                        <span className={`text-sm font-mono font-bold w-12 text-right ${percentage > 90 ? 'text-red-600' : 'text-gray-600'}`}>
                                            {usage}/20
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="space-y-4">
                    {reports.map(report => (
                        <div key={report.id} className="p-4 rounded-xl border border-gray-200 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600 font-bold">{report.version}</span>
                                    <span className="ml-2 text-xs text-gray-400">{new Date(report.timestamp).toLocaleString()}</span>
                                </div>
                                <button onClick={() => copyReport(report)} className="text-brand-600 hover:bg-brand-50 p-1.5 rounded-lg" title="Copy JSON">
                                    <Copy size={16} />
                                </button>
                            </div>
                            <p className="text-gray-800 whitespace-pre-wrap mb-3">{report.message}</p>
                            <div className="pt-3 border-t border-gray-50 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500 font-mono">
                                <span>Route: {report.route}</span>
                                <span>UID: {report.userId}</span>
                                <span>HID: {report.householdId}</span>
                            </div>
                            {report.errorContext && (
                                <div className="mt-2 bg-red-50 p-2 rounded text-xs text-red-700 font-mono overflow-x-auto border border-red-100">
                                    <strong>Error Context:</strong><br/>
                                    {report.errorContext}
                                </div>
                            )}
                        </div>
                    ))}
                    {reports.length === 0 && <div className="text-center py-12 text-gray-400">No feedback reports found.</div>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default DeveloperConsole;
