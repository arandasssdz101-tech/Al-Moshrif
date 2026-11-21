import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Student } from '@/db/types';
import {
  ALGERIA_FLAG_SVG,
  ALGERIA_MAP_WATERMARK_URL,
  CARD_TITLE_AR,
  GUILLOCHE_BG_SVG,
  MINISTRY_EMBLEM_SVG,
  MINISTRY_NAME_AR,
  REPUBLIC_NAME_AR,
  STUDENT_PHOTO_PLACEHOLDER_SVG,
} from '@/utils/studentCardArtwork';
import {
  buildStudentQrForRecord,
  formatCardBirthDate,
  formatCardBirthPlace,
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
  const genderLabel = t(`students.gender.${student.gender}`);
  const birthDateLabel = formatCardBirthDate(student.dateOfBirth);
  const birthPlaceLabel = formatCardBirthPlace(student.placeOfBirth);
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
          ? 'ring-2 ring-primary-600 shadow-md'
          : 'border border-[#b9c4ba] shadow-sm hover:border-[#7f9283]'
      }`}
    >
      {/* Official Algerian Student ID Card Face */}
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
        className={`relative flex flex-col overflow-hidden bg-[linear-gradient(180deg,#e9eee9_0%,#f5f7f4_16%,#f3f6f2_84%,#e3e9e3_100%)] text-[#16201a] ${
          handleBodyClick ? 'cursor-pointer' : ''
        }`}
      >
        {/* Top Metallic Sage-Silver Header Band */}
        <div className="relative z-10 flex items-center justify-between gap-1.5 border-b border-[#7f8c81] bg-[linear-gradient(90deg,#b7c2b8_0%,#d4ddd5_26%,#e4e9e4_54%,#ccd6cd_82%,#bac6bb_100%)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] sm:gap-2 sm:px-3">
          {/* Far Right: Optional Selection Checkbox + Institution Name */}
          <div className="flex min-w-0 max-w-[24%] items-center gap-1.5">
            {selectable && onToggleSelect ? (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                onClick={(event) => event.stopPropagation()}
                aria-label={t('cards.selectStudent', { name: fullName })}
                className="size-4 shrink-0 cursor-pointer rounded border-[#5b695e] accent-primary-700"
              />
            ) : null}
            <span className="truncate text-[11px] font-extrabold text-[#1a241e] sm:text-xs" title={institutionName}>
              {institutionName}
            </span>
          </div>

          {/* Center-Right: Ministry Emblem + Algerian Flag Lockup */}
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex flex-col items-end leading-none">
              <div className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-3 shrink-0 sm:h-2.5 sm:w-3.5 [&>svg]:block [&>svg]:size-full"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: ALGERIA_FLAG_SVG }}
                />
                <span className="whitespace-nowrap text-[6.5px] font-bold tracking-tight text-[#253129] sm:text-[7.5px]">
                  {REPUBLIC_NAME_AR}
                </span>
              </div>
              <span className="mt-0.5 whitespace-nowrap text-[9.5px] font-extrabold text-[#141e18] sm:text-[11px]">
                {MINISTRY_NAME_AR}
              </span>
            </div>
            <span
              className="inline-block h-6 w-7 shrink-0 sm:h-7 sm:w-8 [&>svg]:block [&>svg]:size-full"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: MINISTRY_EMBLEM_SVG }}
            />
          </div>

          {/* Center-Left: Prominent Card Title */}
          <div className="shrink-0 text-center">
            <span className="whitespace-nowrap text-xs font-extrabold tracking-tight text-[#141e18] sm:text-[15px]">
              {CARD_TITLE_AR}
            </span>
          </div>

          {/* Far Left: School Year */}
          <span
            className="shrink-0 whitespace-nowrap text-[11px] font-extrabold tabular-nums text-[#1e2923] sm:text-xs"
            dir="ltr"
          >
            {schoolYear}
          </span>
        </div>

        {/* Card Body with Guilloche Security Curves & Algeria Map Watermark */}
        <div className="relative flex items-center justify-between gap-3 px-3.5 py-3 sm:gap-4 sm:px-4 sm:py-3.5">
          {/* Fine Guilloche Security Pattern */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden [&>svg]:h-full [&>svg]:w-full"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: GUILLOCHE_BG_SVG }}
          />

          {/* Centered Exact Algeria Map + Red Crescent & Star Watermark */}
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            aria-hidden="true"
          >
            <img
              src={ALGERIA_MAP_WATERMARK_URL}
              alt=""
              referrerPolicy="no-referrer"
              className="h-[95%] w-auto select-none object-contain"
            />
          </div>

          {/* Right Column: Student Portrait Box, Full Name, and Structured Fields */}
          <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2 text-right">
            <div className="flex items-end gap-2.5">
              {/* Student Portrait Photo Slot */}
              <div
                className="h-16 w-[54px] shrink-0 overflow-hidden border border-[#616e64] bg-[#ffffff] shadow-sm sm:h-[72px] sm:w-[62px] [&>svg]:block [&>svg]:size-full"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: STUDENT_PHOTO_PLACEHOLDER_SVG }}
              />
              {/* Student Full Name beside photo */}
              <div className="min-w-0 flex-1 pb-1">
                <h3 className="line-clamp-2 text-base font-extrabold leading-snug text-[#141d17] sm:text-lg">
                  {fullName}
                </h3>
              </div>
            </div>

            <dl className="flex flex-col gap-0.5 text-xs leading-snug sm:text-[13px]">
              <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
                <div className="flex items-baseline gap-1">
                  <dt className="shrink-0 font-bold text-[#2d3a32]">{t('cards.fields.class')}:</dt>
                  <dd className="truncate font-extrabold text-[#111814]">{classNameLabel}</dd>
                </div>
                <div className="flex items-baseline gap-1">
                  <dt className="shrink-0 font-bold text-[#2d3a32]">{t('cards.fields.gender')}:</dt>
                  <dd className="truncate font-extrabold text-[#111814]">{genderLabel}</dd>
                </div>
              </div>
              <div className="flex items-baseline gap-1">
                <dt className="shrink-0 font-bold text-[#2d3a32]">{t('cards.fields.dateOfBirth')}:</dt>
                <dd className="truncate font-extrabold tabular-nums text-[#111814]" dir="ltr">
                  {birthDateLabel}
                </dd>
              </div>
              <div className="flex items-baseline gap-1">
                <dt className="shrink-0 font-bold text-[#2d3a32]">{t('cards.fields.placeOfBirth')}:</dt>
                <dd className="truncate font-extrabold text-[#111814]">{birthPlaceLabel}</dd>
              </div>
              <div className="flex items-baseline gap-1">
                <dt className="shrink-0 font-bold text-[#2d3a32]">{t('cards.fields.regime')}:</dt>
                <dd className="truncate font-extrabold text-[#111814]">{regimeLabel}</dd>
              </div>
              <div className="flex items-baseline gap-1">
                <dt className="shrink-0 font-bold text-[#2d3a32]">{t('cards.fields.regId')}:</dt>
                <dd className="truncate font-extrabold tabular-nums text-[#111814]" dir="ltr">
                  {registrationNumber}
                </dd>
              </div>
            </dl>
          </div>

          {/* Left Column: Beveled Metallic Silver-Champagne QR Code Frame */}
          <div className="relative z-10 shrink-0">
            <div
              className="rounded-xl bg-[linear-gradient(145deg,#dbd7cb_0%,#8f8b7e_34%,#e8e5da_68%,#9d998b_100%)] p-[5px] shadow-[0_4px_12px_rgba(26,36,30,0.22)] ring-1 ring-[#6c695e]/75"
              aria-label={t('cards.qrAlt', { name: fullName })}
            >
              <div className="flex size-28 items-center justify-center rounded-[7px] bg-[#ffffff] p-1 shadow-[inset_0_0_0_1px_rgba(120,116,104,0.3)] sm:size-[122px]">
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
          </div>
        </div>

        {/* Bottom Metallic Sage-Silver Footer Band */}
        <div className="relative z-10 flex items-center justify-between gap-2 border-t border-[#7f8c81] bg-[linear-gradient(90deg,#b7c2b8_0%,#d4ddd5_28%,#e2e7e2_58%,#c7d1c8_100%)] px-3.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
          <span className="truncate text-[11px] font-extrabold text-[#1a241e] sm:text-xs">
            {REPUBLIC_NAME_AR}
          </span>
          <span
            className="shrink-0 text-[11px] font-extrabold tabular-nums text-[#1a241e] sm:text-xs"
            dir="ltr"
          >
            {schoolYear}
          </span>
        </div>
      </div>

      {/* Interactive Action Strip (kept separate below the official ID card face) */}
      {onPrintSingle || onDownloadPdfSingle ? (
        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50/90 px-3.5 py-2 text-xs text-neutral-600">
          <span className="truncate">{directorate || t('cards.offlineReady')}</span>
          <div className="flex shrink-0 items-center gap-1">
            {selectable && onSelect ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                }}
                className="inline-flex min-h-8 items-center rounded-lg px-2 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200/70"
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
                className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200/70"
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
