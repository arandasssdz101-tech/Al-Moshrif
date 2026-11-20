import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Student } from '@/db/types';
import {
  buildStudentQrForRecord,
  formatStudentRegime,
  generateStudentQrSvg,
  studentFullName,
  studentRegistrationNumber,
} from '@/utils/studentQr';
import { toPrintableCard, type PrintableStudentCard } from '@/utils/studentCardsPrint';

interface StudentIdCardProps {
  student: Student;
  classNameLabel: string;
  institutionName: string;
  directorate?: string;
  schoolYear: string;
  highlighted?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onSelect?: () => void;
  onPrintSingle?: (card: PrintableStudentCard) => void;
  onDownloadPdfSingle?: (card: PrintableStudentCard) => void;
}

export function StudentIdCard({
  student,
  classNameLabel,
  institutionName,
  directorate,
  schoolYear,
  highlighted = false,
  selectable = false,
  selected = false,
  onToggleSelect,
  onSelect,
  onPrintSingle,
  onDownloadPdfSingle,
}: StudentIdCardProps) {
  const { t } = useTranslation();
  const [qrSvg, setQrSvg] = useState<string>('');
  const fullName = studentFullName(student);
  const registrationNumber = studentRegistrationNumber(student);
  const regimeLabel = formatStudentRegime(student.boardingStatus);
  const qrPayload = buildStudentQrForRecord(student, classNameLabel, schoolYear);

  useEffect(() => {
    let active = true;
    generateStudentQrSvg(qrPayload, 'M')
      .then((svg) => {
        if (active) setQrSvg(svg);
      })
      .catch(() => {
        if (active) setQrSvg('');
      });
    return () => {
      active = false;
    };
  }, [qrPayload]);

  const printableCard = toPrintableCard(student, classNameLabel, institutionName, schoolYear, directorate);
  const handleBodyClick = selectable && onToggleSelect ? onToggleSelect : onSelect;

  return (
    <article
      dir="rtl"
      className={`flex flex-col overflow-hidden rounded-2xl bg-white transition ${
        highlighted || selected
          ? 'ring-2 ring-primary-600 shadow-sm'
          : 'border border-neutral-200 hover:border-primary-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2 bg-primary-700 px-4 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          {selectable && onToggleSelect ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(event) => event.stopPropagation()}
              aria-label={t('cards.selectStudent', { name: fullName })}
              className="size-4 shrink-0 cursor-pointer rounded border-white/70 accent-white"
            />
          ) : null}
          <span className="truncate text-sm font-bold">{institutionName}</span>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums opacity-95" dir="ltr">
          {schoolYear}
        </span>
      </div>

      <div className="border-b border-primary-100 bg-primary-50/70 px-4 py-1 text-center text-xs font-bold text-primary-800">
        {t('cards.cardHeader')}
      </div>

      <div
        onClick={handleBodyClick}
        role={handleBodyClick ? 'button' : undefined}
        tabIndex={handleBodyClick ? 0 : undefined}
        onKeyDown={
          handleBodyClick
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleBodyClick();
                }
              }
            : undefined
        }
        className={`flex items-center justify-between gap-4 p-4 ${handleBodyClick ? 'cursor-pointer' : ''}`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-right">
          <h3 className="truncate text-base font-bold text-neutral-900">{fullName}</h3>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex items-baseline gap-1.5">
              <dt className="shrink-0 text-neutral-500">{t('cards.fields.class')}:</dt>
              <dd className="truncate font-semibold text-neutral-900">{classNameLabel}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="shrink-0 text-neutral-500">{t('cards.fields.regime')}:</dt>
              <dd className="truncate font-semibold text-neutral-900">{regimeLabel}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="shrink-0 text-neutral-500">{t('cards.fields.regId')}:</dt>
              <dd className="truncate font-mono text-xs font-semibold text-neutral-800 tabular-nums" dir="ltr">
                {registrationNumber}
              </dd>
            </div>
          </dl>
        </div>

        <div
          className="flex size-28 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white p-1"
          aria-label={t('cards.qrAlt', { name: fullName })}
        >
          {qrSvg ? (
            <div
              className="size-full [&>svg]:block [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <span className="text-xs text-neutral-400">QR</span>
          )}
        </div>
      </div>

      {onPrintSingle || onDownloadPdfSingle ? (
        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50/70 px-4 py-2 text-xs text-neutral-500">
          <span className="truncate">{directorate || t('cards.offlineReady')}</span>
          <div className="flex shrink-0 items-center gap-1">
            {selectable && onSelect ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                }}
                className="inline-flex min-h-8 items-center rounded-lg px-2 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200/60"
              >
                {t('cards.viewCard')}
              </button>
            ) : null}
            {onDownloadPdfSingle ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownloadPdfSingle(printableCard);
                }}
                className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200/60"
              >
                <FileDown className="size-3.5" aria-hidden />
                <span>{t('cards.downloadPdfSingle')}</span>
              </button>
            ) : null}
            {onPrintSingle ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPrintSingle(printableCard);
                }}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-primary-700 transition hover:bg-primary-50"
              >
                <Printer className="size-3.5" aria-hidden />
                <span>{t('cards.printSingle')}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
