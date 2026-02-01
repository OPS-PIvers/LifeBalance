import React, { useRef } from 'react';
import { Camera, Upload, Type, Shield } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { CaptureMagicAction } from './CaptureMagicAction';
import { MagicActionResponse } from '../../services/geminiService';
import toast from 'react-hot-toast';

interface CaptureMenuProps {
  onScan: () => void;
  onFileSelect: (file: File) => void;
  onManual: () => void;
  householdId: string;
  dynamicCategories: string[];
  onMagicSuccess: (result: MagicActionResponse) => void;
}

export const CaptureMenu: React.FC<CaptureMenuProps> = ({
  onScan,
  onFileSelect,
  onManual,
  householdId,
  dynamicCategories,
  onMagicSuccess
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Basic validation here
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image too large (max 10MB)');
      return;
    }

    onFileSelect(file);

    // Reset input
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">

      <div className="bg-blue-50/50 p-3 rounded-xl ring-1 ring-blue-100/50 flex items-start gap-3">
        <Shield size={16} className="text-blue-600/80 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700/80 leading-relaxed">
          <strong>AI Processing:</strong> Avoid capturing PII like full names or card numbers.
        </p>
      </div>

      <CaptureMagicAction
        householdId={householdId}
        dynamicCategories={dynamicCategories}
        onSuccess={onMagicSuccess}
      />

      <button
        onClick={onScan}
        className="w-full flex items-center gap-4 p-4 bg-white ring-1 ring-slate-200/50 rounded-2xl shadow-sm hover:ring-slate-300/60 hover:bg-slate-50/50 transition-all active:scale-[0.98] group"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-50/50 text-indigo-600 group-hover:scale-110 transition-transform">
          <Camera size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-slate-900 tracking-tight block">Scan Receipt</span>
          <span className="text-xs text-slate-500">Take a photo of your receipt</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full flex items-center gap-4 p-4 bg-white ring-1 ring-slate-200/50 rounded-2xl shadow-sm hover:ring-slate-300/60 hover:bg-slate-50/50 transition-all active:scale-[0.98] group"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-50/50 text-purple-600 group-hover:scale-110 transition-transform">
          <Upload size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-slate-900 tracking-tight block">Upload Image</span>
          <span className="text-xs text-slate-500">Bank statement or receipt screenshot</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </button>

      <button
        onClick={onManual}
        className="w-full flex items-center gap-4 p-4 bg-white ring-1 ring-slate-200/50 rounded-2xl shadow-sm hover:ring-slate-300/60 hover:bg-slate-50/50 transition-all active:scale-[0.98] group"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-50/50 text-emerald-600 group-hover:scale-110 transition-transform">
          <Type size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-slate-900 tracking-tight block">Manual Entry</span>
          <span className="text-xs text-slate-500">Enter transaction details directly</span>
        </div>
        <Badge variant="success" size="sm">
          INSTANT
        </Badge>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="text-center pt-2">
        <p className="text-xs text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.4)]"></span>
            Review = shows in Action Queue
          </span>
          <span className="mx-2">•</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400"></span>
            Instant = updates budget immediately
          </span>
        </p>
      </div>
    </div>
  );
};
