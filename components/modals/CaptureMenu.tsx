import React, { useRef } from 'react';
import { Camera, Upload, Type, Shield } from 'lucide-react';
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

      <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex items-start gap-3">
        <Shield size={16} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
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
        className="w-full flex items-center gap-4 p-4 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-[0.98]"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600">
          <Camera size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-700 block">Scan Receipt</span>
          <span className="text-xs text-brand-400">Take a photo of your receipt</span>
        </div>
        <div className="px-2 py-1 bg-amber-100 text-amber-700 text-xxs font-bold rounded-full">
          REVIEW
        </div>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full flex items-center gap-4 p-4 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-[0.98]"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100 text-purple-600">
          <Upload size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-700 block">Upload Image</span>
          <span className="text-xs text-brand-400">Bank statement or receipt screenshot</span>
        </div>
        <div className="px-2 py-1 bg-amber-100 text-amber-700 text-xxs font-bold rounded-full">
          REVIEW
        </div>
      </button>

      <button
        onClick={onManual}
        className="w-full flex items-center gap-4 p-4 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-[0.98]"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-money-bgPos text-money-pos">
          <Type size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-700 block">Manual Entry</span>
          <span className="text-xs text-brand-400">Enter transaction details directly</span>
        </div>
        <div className="px-2 py-1 bg-green-100 text-green-700 text-xxs font-bold rounded-full">
          INSTANT
        </div>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="text-center pt-2">
        <p className="text-xs text-brand-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
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
