'use client';

import { useState, useCallback, useRef } from 'react';
import { CheckCircle } from 'lucide-react';

interface ToastItem {
  id: number;
  text: string;
  exiting: boolean;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((text: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, text, exiting: false }]);

    // Start exit after 2000ms
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
      );
      // Remove after exit animation (200ms)
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 200);
    }, 2000);
  }, []);

  return { toasts, showToast };
}

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`bg-white shadow-xl border border-gray-100/80 rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all duration-200 ${
            toast.exiting
              ? 'opacity-0 translate-y-2'
              : 'opacity-100 translate-y-0 animate-toast-enter'
          }`}
        >
          <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span className="text-sm text-themis-800 font-medium">{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
