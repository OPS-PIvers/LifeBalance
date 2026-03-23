import React from 'react';

interface AccountSelectItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  balance: number;
}

export const AccountSelectItem: React.FC<AccountSelectItemProps> = ({ name, balance, ...props }) => {
  return (
    <button
      {...props}
      className={`w-full p-4 flex justify-between items-center bg-white hover:bg-slate-50 rounded-2xl border border-slate-100 hover:border-slate-200 shadow-sm hover:shadow-md transition-all group ${props.className || ''}`}
    >
      <span className="font-bold text-slate-700 text-sm group-hover:text-slate-900">{name}</span>
      <span className="font-mono text-xs text-slate-400 group-hover:text-slate-600">
        ${balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
      </span>
    </button>
  );
};
