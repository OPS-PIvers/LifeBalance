export interface StoreColor {
  id: string;
  label: string;
  bg: string;
  text: string;
  border: string;
  iconBg: string; // for the store icon circle
}

export const STORE_COLORS: Record<string, StoreColor> = {
  red: { id: 'red', label: 'Red', bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200', iconBg: 'bg-red-100 text-red-600' },
  orange: { id: 'orange', label: 'Orange', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', iconBg: 'bg-orange-100 text-orange-600' },
  amber: { id: 'amber', label: 'Amber', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', iconBg: 'bg-amber-100 text-amber-600' },
  green: { id: 'green', label: 'Green', bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200', iconBg: 'bg-green-100 text-green-600' },
  teal: { id: 'teal', label: 'Teal', bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-200', iconBg: 'bg-teal-100 text-teal-600' },
  blue: { id: 'blue', label: 'Blue', bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200', iconBg: 'bg-blue-100 text-blue-600' },
  indigo: { id: 'indigo', label: 'Indigo', bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200', iconBg: 'bg-indigo-100 text-indigo-600' },
  purple: { id: 'purple', label: 'Purple', bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200', iconBg: 'bg-purple-100 text-purple-600' },
  pink: { id: 'pink', label: 'Pink', bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-200', iconBg: 'bg-pink-100 text-pink-600' },
  gray: { id: 'gray', label: 'Gray', bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200', iconBg: 'bg-gray-100 text-gray-600' },
};

export const DEFAULT_STORE_COLOR = 'gray';
