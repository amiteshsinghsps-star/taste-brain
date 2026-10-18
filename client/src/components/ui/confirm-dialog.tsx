import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title = 'Confirm Delete Action',
  description,
  confirmText = 'Delete Permanently',
  cancelText = 'Cancel',
  onConfirm,
  onClose,
  loading = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
        <div className="flex items-start space-x-3">
          <div className="h-10 w-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
          <Button type="button" variant="ghost" onClick={onClose} className="text-xs">
            {cancelText}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="text-xs px-5 py-2 rounded-xl font-medium"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {loading ? 'Deleting...' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
