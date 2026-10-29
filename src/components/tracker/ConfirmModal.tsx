import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface ConfirmModalProps {
  dialog: ConfirmDialogState;
  onClose: () => void;
}

export function ConfirmModal({ dialog, onClose }: ConfirmModalProps) {
  if (!dialog.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/80 p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">{dialog.title}</h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {dialog.description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={dialog.onConfirm}
            className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25 transition"
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
