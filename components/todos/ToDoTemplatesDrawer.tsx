import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Trash2, FileText, Plus, X } from 'lucide-react';
import { ToDoTemplate } from '@/types/schema';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ToDoTemplatesDrawer: React.FC<Props> = ({ isOpen, onClose }) => {
  const { todoTemplates, addToDoTemplate, updateToDoTemplate, deleteToDoTemplate, addToDo, currentUser } = useHousehold();

  const [view, setView] = useState<'list' | 'edit'>('list');
  const [editingTemplate, setEditingTemplate] = useState<Partial<ToDoTemplate>>({});
  const [newItemText, setNewItemText] = useState('');

  const handleApply = async (template: ToDoTemplate) => {
    if (!currentUser) return;
    const toastId = toast.loading('Applying template...');
    try {
        const today = new Date().toISOString().split('T')[0];
        // Create promises
        const promises = template.items.map(item => addToDo({
            text: item.text,
            priority: item.priority || 'medium',
            completeByDate: today,
            assignedTo: currentUser.uid, // Default to current user
            isCompleted: false,
            source: 'template' // Note: This literal string needs to be supported by schema or typed loosely
        }));
        await Promise.all(promises);
        toast.success(`Added ${template.items.length} tasks`, { id: toastId });
        onClose();
    } catch (error) {
        console.error(error);
        toast.error('Failed to apply template', { id: toastId });
    }
  };

  const handleSave = async () => {
      if (!editingTemplate.name?.trim()) {
          toast.error('Template name is required');
          return;
      }
      try {
          if (editingTemplate.id) {
              await updateToDoTemplate(editingTemplate as ToDoTemplate);
          } else {
              await addToDoTemplate({
                  name: editingTemplate.name,
                  items: editingTemplate.items || [],
                  createdAt: new Date().toISOString(),
                  createdBy: currentUser?.uid || '',
                  color: 'blue', // Default
                  icon: 'FileText' // Default
              });
          }
          setView('list');
          setEditingTemplate({});
      } catch (error) {
          console.error(error);
      }
  };

  const addItem = () => {
      if (!newItemText.trim()) return;
      setEditingTemplate(prev => ({
          ...prev,
          items: [...(prev.items || []), { text: newItemText.trim(), priority: 'medium' }]
      }));
      setNewItemText('');
  };

  const removeItem = (index: number) => {
      setEditingTemplate(prev => ({
          ...prev,
          items: (prev.items || []).filter((_, i) => i !== index)
      }));
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={() => {
          onClose();
          setView('list');
          setEditingTemplate({});
      }}
      title={view === 'edit' ? (editingTemplate.id ? 'Edit Template' : 'New Template') : 'To-Do Templates'}
    >
      {view === 'list' ? (
          <div className="space-y-4">
            <button
                onClick={() => {
                    setEditingTemplate({ items: [] });
                    setView('edit');
                }}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 font-bold hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 transition-all flex items-center justify-center gap-2"
            >
                <Plus size={20} />
                Create New Template
            </button>

            {todoTemplates.length === 0 ? (
                // Empty State
                <div className="text-center py-8 text-slate-400">
                    <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>No templates yet.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {todoTemplates.map(template => (
                        <div key={template.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="font-bold text-slate-900">{template.name}</h3>
                                    <p className="text-xs text-slate-500">{template.items.length} tasks</p>
                                </div>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => {
                                            setEditingTemplate(template);
                                            setView('edit');
                                        }}
                                        className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => {
                                            if(confirm('Delete template?')) deleteToDoTemplate(template.id);
                                        }}
                                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => handleApply(template)}
                                className="w-full py-2 bg-brand-50 text-brand-700 hover:bg-brand-100 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <Plus size={16} />
                                Use Template
                            </button>
                        </div>
                    ))}
                </div>
            )}
          </div>
      ) : (
          // Edit View
          <div className="space-y-6">
              <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Template Name</label>
                  <input
                      className="w-full mt-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-brand-500 outline-none"
                      placeholder="e.g. Weekly Cleaning"
                      value={editingTemplate.name || ''}
                      onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})}
                      autoFocus
                  />
              </div>

              <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tasks</label>
                  <div className="space-y-2 mb-3">
                      {(editingTemplate.items || []).map((item, index) => (
                          <div key={index} className="flex items-center gap-2 p-2 bg-white border border-slate-100 rounded-lg shadow-sm">
                              <span className="flex-1 text-sm font-medium text-slate-700">{item.text}</span>
                              <button onClick={() => removeItem(index)} className="text-slate-400 hover:text-rose-500 p-1">
                                  <X size={14} />
                              </button>
                          </div>
                      ))}
                  </div>

                  <div className="flex gap-2">
                      <input
                          className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                          placeholder="Add task..."
                          value={newItemText}
                          onChange={e => setNewItemText(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addItem()}
                      />
                      <button
                          onClick={addItem}
                          disabled={!newItemText.trim()}
                          className="p-2 bg-slate-900 text-white rounded-lg disabled:opacity-50"
                      >
                          <Plus size={20} />
                      </button>
                  </div>
              </div>

              <div className="pt-4 flex gap-3">
                  <button
                      onClick={() => setView('list')}
                      className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                  >
                      Cancel
                  </button>
                  <button
                      onClick={handleSave}
                      disabled={!editingTemplate.name?.trim()}
                      className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all disabled:opacity-50"
                  >
                      Save Template
                  </button>
              </div>
          </div>
      )}
    </Drawer>
  );
};
