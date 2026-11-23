import { useEffect, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Info, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import {
  getGateDateResetPreview,
  resetGateEntriesForDate,
  type ResetGateEntriesForDateResult,
} from '@/db/entries';
import { isIsoDate } from '@/utils/absences';
import type { GateDateResetSummary } from '@/utils/entryReset';
import { errorKey } from '@/utils/errors';

interface EntryResetDateModalProps {
  open: boolean;
  institutionId: string;
  actorId: string;
  today: string;
  initialDate: string;
  onClose: () => void;
  onResetComplete: (result: ResetGateEntriesForDateResult) => Promise<void> | void;
}

export function EntryResetDateModal({
  open,
  institutionId,
  actorId,
  today,
  initialDate,
  onClose,
  onResetComplete,
}: EntryResetDateModalProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState(initialDate);
  const [includeGateAndClosure, setIncludeGateAndClosure] = useState(true);
  const [preview, setPreview] = useState<GateDateResetSummary | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(isIsoDate(initialDate) ? initialDate : today);
    setIncludeGateAndClosure(true);
    setError(null);
  }, [open, initialDate, today]);

  useEffect(() => {
    if (!open || !isIsoDate(date)) {
      setPreview(null);
      return;
    }
    let active = true;
    setLoadingPreview(true);
    setError(null);
    getGateDateResetPreview(institutionId, date)
      .then((summary) => {
        if (!active) return;
        setPreview(summary);
      })
      .catch((cause) => {
        if (!active) return;
        setError(t(errorKey(cause)));
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });
    return () => {
      active = false;
    };
  }, [open, institutionId, date, t]);

  const canConfirm = Boolean(
    preview &&
      !loadingPreview &&
      !submitting &&
      (includeGateAndClosure ? preview.hasAnythingToReset : preview.entriesCount > 0),
  );

  const handleConfirm = async () => {
    if (!canConfirm || !isIsoDate(date)) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await resetGateEntriesForDate(institutionId, actorId, date, {
        includeGateAbsences: includeGateAndClosure,
        resetClosure: includeGateAndClosure,
      });
      await onResetComplete(result);
      onClose();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('entry.resetByDate.title')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">{t('entry.resetByDate.subtitle')}</p>

        {/* Date Picker */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="entry-reset-date-input"
            className="text-xs font-semibold text-neutral-700"
          >
            {t('entry.resetByDate.dateLabel')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[11rem]">
              <Calendar
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <input
                id="entry-reset-date-input"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 pe-3 ps-9 text-sm font-medium text-neutral-900 focus:border-primary-500 focus:bg-white"
              />
            </div>
            {date !== today ? (
              <Button variant="secondary" type="button" onClick={() => setDate(today)}>
                {t('entry.today.backToToday')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Live Date Preview */}
        {loadingPreview ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
            {t('common.loading')}
          </div>
        ) : preview ? (
          <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col rounded-lg border border-neutral-200 bg-white p-2.5 text-center">
                <span className="text-[11px] font-medium text-neutral-500">
                  {t('entry.resetByDate.previewEntries')}
                </span>
                <span className="mt-0.5 text-lg font-extrabold tabular-nums text-neutral-900">
                  {preview.entriesCount}
                </span>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {t('entry.resetByDate.previewAccepted', { count: preview.acceptedCount })}
                </span>
              </div>

              <div className="flex flex-col rounded-lg border border-neutral-200 bg-white p-2.5 text-center">
                <span className="text-[11px] font-medium text-neutral-500">
                  {t('entry.resetByDate.previewGateAbsences')}
                </span>
                <span className="mt-0.5 text-lg font-extrabold tabular-nums text-danger-700">
                  {preview.gateAbsencesCount}
                </span>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {t('entry.resetByDate.previewGateOnly')}
                </span>
              </div>

              <div className="flex flex-col rounded-lg border border-neutral-200 bg-white p-2.5 text-center">
                <span className="text-[11px] font-medium text-neutral-500">
                  {t('entry.resetByDate.previewDayStatus')}
                </span>
                <span className="mt-1 text-xs font-bold text-neutral-800">
                  {preview.isClosed
                    ? t('entry.resetByDate.statusClosed')
                    : preview.isSynced
                      ? t('entry.resetByDate.statusSynced')
                      : t('entry.resetByDate.statusOpen')}
                </span>
              </div>
            </div>

            {preview.manualAbsencesCount > 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-900">
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary-700" aria-hidden />
                <span>
                  {t('entry.resetByDate.manualPreservedNote', {
                    count: preview.manualAbsencesCount,
                  })}
                </span>
              </div>
            ) : null}

            {!(includeGateAndClosure ? preview.hasAnythingToReset : preview.entriesCount > 0) ? (
              <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-neutral-600">
                <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden />
                <span>{t('entry.resetByDate.nothingToReset')}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Option: Include gate absences & closure */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={includeGateAndClosure}
            onChange={(e) => setIncludeGateAndClosure(e.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-neutral-900">
              {t('entry.resetByDate.includeGateAbsencesLabel')}
            </span>
            <span className="text-xs text-neutral-500">
              {t('entry.resetByDate.includeGateAbsencesHint')}
            </span>
          </span>
        </label>

        {canConfirm ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-xs text-warning-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
            <span>{t('entry.resetByDate.confirmWarning', { date })}</span>
          </div>
        ) : null}

        <FormError message={error} />

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            <RotateCcw className="size-4" aria-hidden />
            {submitting ? t('common.saving') : t('entry.resetByDate.confirmButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
