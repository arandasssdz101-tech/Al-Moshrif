import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import {
  closeEntryDay,
  previewCloseEntryDay,
  type CloseEntryDayPreview,
} from '@/db/entries';
import { errorKey } from '@/utils/errors';

interface EntryCloseModalProps {
  open: boolean;
  institutionId: string;
  actorId: string;
  date: string;
  onClose: () => void;
  onClosed: (createdAbsencesCount: number) => void;
}

export function EntryCloseModal({
  open,
  institutionId,
  actorId,
  date,
  onClose,
  onClosed,
}: EntryCloseModalProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<CloseEntryDayPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    previewCloseEntryDay(institutionId, date)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((err) => {
        if (active) setError(t(errorKey(err)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, institutionId, date, t]);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { createdAbsencesCount } = await closeEntryDay(institutionId, actorId, date);
      onClosed(createdAbsencesCount);
      onClose();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('entry.closeDay.title')}
      description={t('entry.closeDay.subtitle', { date })}
      onClose={onClose}
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={onClose} />
      ) : preview ? (
        <div className="flex flex-col gap-4">
          {!preview.cardAbsenceEnabled ? (
            <div className="flex items-start gap-3 rounded-xl bg-neutral-100 p-3.5 text-sm text-neutral-700">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary-600" aria-hidden />
              <span>{t('entry.closeDay.cardAbsenceOffNote')}</span>
            </div>
          ) : preview.beforeTrackingStart ? (
            <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                {t('entry.closeDay.beforeTrackingStartNote', { date: preview.trackingStart ?? '' })}
              </span>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-amber-50 p-3.5 text-sm text-amber-900">
                <p className="font-bold">
                  {t('entry.closeDay.willMarkCount', {
                    students: preview.absentStudents.length,
                    records: preview.totalNewAbsenceRecords,
                  })}
                </p>
                <p className="mt-1 text-xs text-amber-800">{t('entry.closeDay.noOverwriteHint')}</p>
              </div>

              {preview.absentStudents.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-neutral-600">
                    {t('entry.closeDay.notEnteredList', { count: preview.absentStudents.length })}
                  </span>
                  <ul className="max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-50">
                    {preview.absentStudents.map((item) => (
                      <li
                        key={item.studentId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="truncate font-semibold text-neutral-900">{item.studentName}</span>
                        <span className="shrink-0 text-xs text-neutral-600">
                          {item.className} · {t('entry.closeDay.periodsCount', { count: item.periods.length })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-emerald-700">{t('entry.closeDay.noneToMark')}</p>
              )}

              {preview.markLateMissedLessons && preview.lateMissedStudents.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-neutral-600">
                    {t('entry.closeDay.lateMissedList', { count: preview.lateMissedStudents.length })}
                  </span>
                  <ul className="max-h-36 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/60">
                    {preview.lateMissedStudents.map((item) => (
                      <li
                        key={item.studentId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="truncate font-semibold text-neutral-900">{item.studentName}</span>
                        <span className="shrink-0 text-xs text-amber-800">
                          {item.className} · {t('entry.closeDay.periodsCount', { count: item.periods.length })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button type="button" variant="secondary" fullWidth onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              fullWidth
              onClick={() => void handleConfirm()}
              disabled={submitting}
              icon={<Lock className="size-4" aria-hidden />}
            >
              {t('entry.closeDay.confirmButton')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
