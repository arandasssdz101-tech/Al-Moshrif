import { Check, ChevronRight, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { User, UserStatus } from '@/db/types';

interface SupervisorRowProps {
  supervisor: User;
  assignedClassNames: string[];
  busy: boolean;
  onOpen: (userId: string) => void;
  onSetStatus: (userId: string, status: UserStatus) => void;
  onDelete: (supervisor: User) => void;
}

const STATUS_TONE: Record<UserStatus, string> = {
  pending: 'bg-warning-50 text-warning-700',
  approved: 'bg-success-50 text-success-700',
  rejected: 'bg-danger-50 text-danger-700',
};

export function SupervisorRow({
  supervisor,
  assignedClassNames,
  busy,
  onOpen,
  onSetStatus,
  onDelete,
}: SupervisorRowProps) {
  const { t } = useTranslation();
  const status = supervisor.status;
  const summary =
    status === 'approved'
      ? assignedClassNames.length > 0
        ? assignedClassNames.join(', ')
        : t('supervisors.noClasses')
      : null;

  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-base font-medium text-neutral-900">{supervisor.name}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
            {t(`supervisors.status.${status}`)}
          </span>
        </span>
        <span dir="ltr" className="self-start truncate font-mono text-xs text-neutral-500">
          @{supervisor.usernameKey}
        </span>
        {summary ? <span className="text-sm text-neutral-500">{summary}</span> : null}
      </span>
      {status === 'approved' ? (
        <ChevronRight className="size-5 shrink-0 text-neutral-400 rtl:-scale-x-100" aria-hidden />
      ) : null}
    </>
  );

  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200 animate-fade-in">
      <div className="flex items-center gap-2">
        {status === 'approved' ? (
          <button
            type="button"
            onClick={() => onOpen(supervisor.id)}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl text-start transition hover:opacity-80"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3">{body}</div>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(supervisor)}
          aria-label={`${t('supervisors.removeSupervisor')}: ${supervisor.name}`}
          title={t('supervisors.removeSupervisor')}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-danger-600 transition hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-500/30 disabled:opacity-50"
        >
          <Trash2 className="size-5" aria-hidden />
        </button>
      </div>

      {status === 'pending' ? (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => onSetStatus(supervisor.id, 'approved')} icon={<Check className="size-5" aria-hidden />} className="min-h-11">
            {t('supervisors.approve')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => onSetStatus(supervisor.id, 'rejected')} icon={<X className="size-5" aria-hidden />} className="min-h-11">
            {t('supervisors.reject')}
          </Button>
        </div>
      ) : null}

      {status === 'rejected' ? (
        <Button variant="secondary" disabled={busy} onClick={() => onSetStatus(supervisor.id, 'approved')} icon={<Check className="size-5" aria-hidden />} className="min-h-11">
          {t('supervisors.reconsider')}
        </Button>
      ) : null}
    </li>
  );
}
