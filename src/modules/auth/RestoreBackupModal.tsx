import { AlertTriangle, Building2, GraduationCap, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { BackupSummary } from '@/db/backup';

interface RestoreBackupModalProps {
  open: boolean;
  summary: BackupSummary | null;
  willOverwrite: boolean;
  restoring: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreBackupModal({
  open,
  summary,
  willOverwrite,
  restoring,
  onConfirm,
  onCancel,
}: RestoreBackupModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      title={t('auth.backup.confirmTitle')}
      description={t('auth.backup.confirmBody')}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-4">
        {summary ? (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
            {summary.institutionNames.length > 0 ? (
              <div className="flex items-start gap-2.5 text-neutral-800">
                <Building2 className="mt-0.5 size-4 shrink-0 text-primary-600" aria-hidden />
                <span className="font-medium">
                  {t('auth.backup.summaryInstitution')}: {summary.institutionNames.join('، ')}
                </span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-4 text-neutral-600">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4 text-neutral-500" aria-hidden />
                {t('auth.backup.summaryAccounts')}: <strong className="text-neutral-900">{summary.activeUserCount}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="size-4 text-neutral-500" aria-hidden />
                {t('auth.backup.summaryStudents')}: <strong className="text-neutral-900">{summary.studentCount}</strong>
              </span>
            </div>
          </div>
        ) : null}

        {willOverwrite ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl bg-warning-50 p-3.5 text-sm text-warning-800"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{t('auth.backup.overwriteWarning')}</p>
          </div>
        ) : null}

        <div className="mt-1 flex flex-col gap-3 sm:flex-row-reverse">
          <Button
            variant={willOverwrite ? 'danger' : 'primary'}
            fullWidth
            onClick={onConfirm}
            disabled={restoring}
          >
            {restoring ? t('auth.backup.restoring') : t('common.confirm')}
          </Button>
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={restoring}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
