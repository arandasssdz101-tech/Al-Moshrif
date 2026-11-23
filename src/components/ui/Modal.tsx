import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { registerAndroidBackHandler } from '@/utils/androidBack';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
}

export function Modal({ open, title, description, onClose, children }: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    const removeBackHandler = registerAndroidBackHandler(() => {
      onClose();
      return true;
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
      removeBackHandler();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] bg-slate-950/50 backdrop-blur-sm animate-fade-in dark:bg-slate-950/75" onClick={onClose} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center sm:inset-0 sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px)) + 16px)' }}
          className="pointer-events-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl animate-fade-up sm:rounded-3xl"
        >
          <div className="mb-2 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl font-bold text-neutral-900">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="-me-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100"
            >
              <X className="size-5" />
            </button>
          </div>
          {description ? <p className="mb-6 text-base text-neutral-600">{description}</p> : null}
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
