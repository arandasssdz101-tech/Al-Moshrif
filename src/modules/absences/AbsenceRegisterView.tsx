import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar,
  ClipboardList,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  Printer,
  Search,
  UserPlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState, FormError } from '@/components/ui/StatusBlock';
import type { AbsenceWorkspace } from '@/db/absences';
import type { StudentAbsence } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import {
  buildClassAbsenceRegister,
  formatMonthTitle,
  type ClassAbsenceRegister,
  type RegisterDailyTotal,
  type RegisterDayCell,
  type RegisterDayInfo,
  type RegisterStudentRow,
} from '@/utils/absenceRegister';
import {
  exportAbsenceRegisterExcel,
  printAbsenceRegister,
  type AbsenceRegisterExportLabels,
  type AbsenceRegisterExportMeta,
} from '@/utils/absenceRegisterExport';
import { isMonthValue } from '@/utils/absenceReports';
import { registerAndroidBackHandler } from '@/utils/androidBack';
import { todayIso } from '@/utils/dates';
import { getEntrySettings } from '@/utils/entry';
import { PERIODS } from '@/utils/schedule';
import { schoolYearForDate } from '@/utils/schoolYear';

type StudentFilterMode = 'all' | 'absentOnly';

const ZOOM_LEVELS = [30, 45, 60, 75, 100, 125, 150] as const;
type ZoomLevel = (typeof ZOOM_LEVELS)[number];

interface ZoomStyleConfig {
  idxPx: number;
  namePx: number;
  daySubPx: number;
  sumPx: number;
  totalPx: number;
  rowHPx: number;
  fontPx: number;
  subFontPx: number;
  headPadYPx: number;
  headPadXPx: number;
  namePadXPx: number;
  footerPadYPx: number;
}

const ZOOM_CONFIGS: Record<ZoomLevel, ZoomStyleConfig> = {
  30: {
    idxPx: 22,
    namePx: 76,
    daySubPx: 11,
    sumPx: 22,
    totalPx: 24,
    rowHPx: 24,
    fontPx: 8,
    subFontPx: 8,
    headPadYPx: 2,
    headPadXPx: 0,
    namePadXPx: 4,
    footerPadYPx: 4,
  },
  45: {
    idxPx: 24,
    namePx: 84,
    daySubPx: 14,
    sumPx: 26,
    totalPx: 28,
    rowHPx: 28,
    fontPx: 9,
    subFontPx: 9,
    headPadYPx: 2,
    headPadXPx: 2,
    namePadXPx: 6,
    footerPadYPx: 6,
  },
  60: {
    idxPx: 28,
    namePx: 92,
    daySubPx: 18,
    sumPx: 32,
    totalPx: 36,
    rowHPx: 28,
    fontPx: 10,
    subFontPx: 9,
    headPadYPx: 4,
    headPadXPx: 2,
    namePadXPx: 6,
    footerPadYPx: 6,
  },
  75: {
    idxPx: 28,
    namePx: 100,
    daySubPx: 24,
    sumPx: 36,
    totalPx: 40,
    rowHPx: 32,
    fontPx: 11,
    subFontPx: 10,
    headPadYPx: 4,
    headPadXPx: 4,
    namePadXPx: 8,
    footerPadYPx: 6,
  },
  100: {
    idxPx: 32,
    namePx: 112,
    daySubPx: 28,
    sumPx: 42,
    totalPx: 48,
    rowHPx: 36,
    fontPx: 12,
    subFontPx: 11,
    headPadYPx: 6,
    headPadXPx: 4,
    namePadXPx: 8,
    footerPadYPx: 8,
  },
  125: {
    idxPx: 36,
    namePx: 136,
    daySubPx: 36,
    sumPx: 48,
    totalPx: 56,
    rowHPx: 40,
    fontPx: 14,
    subFontPx: 12,
    headPadYPx: 6,
    headPadXPx: 6,
    namePadXPx: 10,
    footerPadYPx: 8,
  },
  150: {
    idxPx: 40,
    namePx: 152,
    daySubPx: 44,
    sumPx: 56,
    totalPx: 64,
    rowHPx: 44,
    fontPx: 16,
    subFontPx: 12,
    headPadYPx: 8,
    headPadXPx: 8,
    namePadXPx: 12,
    footerPadYPx: 8,
  },
};

function zoomCssVariables(zoom: ZoomLevel): CSSProperties {
  const cfg = ZOOM_CONFIGS[zoom];
  return {
    '--reg-idx-w': `${cfg.idxPx}px`,
    '--reg-name-w': `${cfg.namePx}px`,
    '--reg-sub-w': `${cfg.daySubPx}px`,
    '--reg-sum-w': `${cfg.sumPx}px`,
    '--reg-total-w': `${cfg.totalPx}px`,
    '--reg-row-h': `${cfg.rowHPx}px`,
    '--reg-font': `${cfg.fontPx}px`,
    '--reg-sub-font': `${cfg.subFontPx}px`,
    '--reg-head-py': `${cfg.headPadYPx}px`,
    '--reg-head-px': `${cfg.headPadXPx}px`,
    '--reg-name-px': `${cfg.namePadXPx}px`,
    '--reg-footer-py': `${cfg.footerPadYPx}px`,
  } as CSSProperties;
}

function computeFitZoom(dayCount: number, availableWidth: number): ZoomLevel {
  if (availableWidth <= 0 || dayCount <= 0) return 45;
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
    const level = ZOOM_LEVELS[i];
    if (level > 100) continue;
    const cfg = ZOOM_CONFIGS[level];
    const estimated =
      cfg.idxPx + cfg.namePx + dayCount * 2 * cfg.daySubPx + cfg.sumPx * 2 + cfg.totalPx + 12;
    if (estimated <= availableWidth) return level;
  }
  return ZOOM_LEVELS[0];
}

interface SelectedCellDetail {
  row: RegisterStudentRow;
  cell: RegisterDayCell;
  isSchoolDay: boolean;
  isHoliday: boolean;
}

interface AbsenceRegisterViewProps {
  data: AbsenceWorkspace;
  selectedClassId: string | null;
  onSelectClass: (classId: string) => void;
  onOpenDayEditor: (classId: string, date: string) => void;
  canAddStudent?: boolean;
  onAddStudent?: (classId: string | null) => void;
}

function periodTimeRange(periodNumber: number): string {
  const found = PERIODS.find((item) => item.number === periodNumber);
  return found ? `${found.start} - ${found.end}` : '';
}

function sourceLabel(
  source: StudentAbsence['source'],
  t: (key: string) => string,
): string {
  if (source === 'gate') return t('absences.register.sourceGate');
  if (source === 'continuous') return t('absences.register.sourceContinuous');
  return t('absences.register.sourceManual');
}

export function AbsenceRegisterView({
  data,
  selectedClassId,
  onSelectClass,
  onOpenDayEditor,
  canAddStudent = false,
  onAddStudent,
}: AbsenceRegisterViewProps) {
  const { t, i18n } = useTranslation();
  const { institution } = useSession();
  const currentMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<StudentFilterMode>('all');
  const [exporting, setExporting] = useState<'class' | 'all' | null>(null);
  const [detail, setDetail] = useState<SelectedCellDetail | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel>(100);
  const [fullscreen, setFullscreen] = useState(false);

  const inlineScrollRef = useRef<HTMLDivElement | null>(null);
  const fullscreenScrollRef = useRef<HTMLDivElement | null>(null);
  const detailOpenRef = useRef(false);
  detailOpenRef.current = detail !== null;

  const validMonth = isMonthValue(month);
  const activeClass =
    data.classes.find((item) => item.id === selectedClassId) ?? data.classes[0] ?? null;
  const eveningStartTime = getEntrySettings(institution).eveningStartTime;
  const dir: 'rtl' | 'ltr' = i18n.dir() === 'rtl' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !detailOpenRef.current) {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const removeBackHandler = registerAndroidBackHandler(() => {
      if (detailOpenRef.current) return false;
      setFullscreen(false);
      return true;
    });
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
      removeBackHandler();
    };
  }, [fullscreen]);

  const register: ClassAbsenceRegister | null = useMemo(() => {
    if (!validMonth || !activeClass) return null;
    return buildClassAbsenceRegister({
      schoolClass: activeClass,
      students: data.students,
      studentAbsences: data.studentAbsences,
      month,
      workingDays: data.workingDays,
      holidayDates: data.holidayDates,
      eveningStartTime,
      lang: i18n.language,
    });
  }, [
    validMonth,
    activeClass,
    data.students,
    data.studentAbsences,
    month,
    data.workingDays,
    data.holidayDates,
    eveningStartTime,
    i18n.language,
  ]);

  const filteredRows = useMemo(() => {
    if (!register) return [];
    const query = search.trim().toLocaleLowerCase();
    return register.rows.filter((row) => {
      if (filterMode === 'absentOnly' && row.totalHours === 0) return false;
      if (!query) return true;
      return row.fullName.toLocaleLowerCase().includes(query);
    });
  }, [register, search, filterMode]);

  const handleInspectCell = useCallback(
    (rowIdx: number, dayIdx: number) => {
      if (!register) return;
      const row = filteredRows[rowIdx];
      const cell = row?.days[dayIdx];
      const dayInfo = register.days[dayIdx];
      if (!row || !cell) return;
      setDetail({
        row,
        cell,
        isSchoolDay: dayInfo?.isSchoolDay ?? true,
        isHoliday: dayInfo?.isHoliday ?? false,
      });
    },
    [register, filteredRows],
  );

  const tableLabels = useMemo(
    () => ({
      colIndex: t('absences.register.colIndex'),
      colFullName: t('absences.register.colFullName'),
      colDaysHeader: t('absences.register.colDaysHeader'),
      colMonthlyTotal: t('absences.register.colMonthlyTotal'),
      shortMorning: t('absences.register.shortMorning'),
      shortEvening: t('absences.register.shortEvening'),
      colTotal: t('absences.register.colTotal'),
      footerTotal: t('absences.register.footerTotal'),
      leftBadge: t('absences.register.leftBadge'),
    }),
    [t],
  );

  const tableStyle = useMemo(() => zoomCssVariables(zoom), [zoom]);

  if (activeClass === null) {
    return (
      <EmptyState
        icon={<ClipboardList className="size-7" aria-hidden />}
        title={t('timetable.noClassesTitle')}
        body={data.access.isHead ? t('timetable.noClassesBody') : t('timetable.noAssignedClasses')}
      />
    );
  }

  const monthDisplay = validMonth ? formatMonthTitle(month, i18n.language) : month;

  const exportMeta: AbsenceRegisterExportMeta = {
    institutionName: institution.name,
    monthDisplay,
    schoolYear: schoolYearForDate(validMonth ? `${month}-15` : todayIso()),
    lang: i18n.language,
    dir,
  };

  const exportLabels: AbsenceRegisterExportLabels = {
    bannerTitle: t('absences.register.bannerTitle'),
    institutionLabel: t('absences.register.institutionLabel'),
    monthLabel: t('absences.register.monthLabel'),
    classLabel: t('absences.register.classLabel'),
    schoolYearLabel: t('absences.register.schoolYearLabel'),
    legendText: t('absences.register.legendText'),
    colIndex: tableLabels.colIndex,
    colFullName: tableLabels.colFullName,
    colDaysHeader: tableLabels.colDaysHeader,
    colMonthlyTotal: tableLabels.colMonthlyTotal,
    shortMorning: tableLabels.shortMorning,
    shortEvening: tableLabels.shortEvening,
    colTotal: tableLabels.colTotal,
    footerTotal: tableLabels.footerTotal,
    filePrefix: t('absences.register.filePrefix'),
  };

  const handleExportClassExcel = async () => {
    if (!register || exporting) return;
    setExporting('class');
    try {
      await exportAbsenceRegisterExcel([register], exportMeta, exportLabels);
    } finally {
      setExporting(null);
    }
  };

  const handleExportAllClassesExcel = async () => {
    if (!validMonth || data.classes.length === 0 || exporting) return;
    setExporting('all');
    try {
      const allRegisters = data.classes.map((schoolClass) =>
        buildClassAbsenceRegister({
          schoolClass,
          students: data.students,
          studentAbsences: data.studentAbsences,
          month,
          workingDays: data.workingDays,
          holidayDates: data.holidayDates,
          eveningStartTime,
          lang: i18n.language,
        }),
      );
      await exportAbsenceRegisterExcel(allRegisters, exportMeta, exportLabels);
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = () => {
    if (!register) return;
    printAbsenceRegister(register, exportMeta, exportLabels);
  };

  const zoomIndex = ZOOM_LEVELS.indexOf(zoom);
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;

  const handleZoomOut = () => {
    if (canZoomOut) setZoom(ZOOM_LEVELS[zoomIndex - 1]);
  };

  const handleZoomIn = () => {
    if (canZoomIn) setZoom(ZOOM_LEVELS[zoomIndex + 1]);
  };

  const handleFitMonth = () => {
    if (!register) return;
    const targetRef = fullscreen ? fullscreenScrollRef.current : inlineScrollRef.current;
    const width =
      targetRef?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth - 32 : 1024);
    setZoom(computeFitZoom(register.days.length, width));
  };

  const handleEnterFullscreen = () => {
    if (!register) return;
    if (typeof window !== 'undefined') {
      const fitWidth = Math.max(320, window.innerWidth - 16);
      setZoom(computeFitZoom(register.days.length, fitWidth));
    }
    setFullscreen(true);
  };

  const zoomControls = (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex items-center rounded-xl border border-neutral-300 bg-white p-0.5">
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={!canZoomOut}
          title={t('absences.register.zoomOut')}
          aria-label={t('absences.register.zoomOut')}
          className="flex size-9 items-center justify-center rounded-lg text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setZoom(100)}
          title={t('absences.register.resetZoom')}
          aria-label={t('absences.register.resetZoom')}
          className="min-w-[3.25rem] rounded-lg px-2 py-1 text-center text-xs font-bold text-neutral-900 tabular-nums transition hover:bg-neutral-100"
        >
          {zoom}%
        </button>
        <button
          type="button"
          onClick={handleZoomIn}
          disabled={!canZoomIn}
          title={t('absences.register.zoomIn')}
          aria-label={t('absences.register.zoomIn')}
          className="flex size-9 items-center justify-center rounded-lg text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={!register}
        onClick={handleFitMonth}
        icon={<MoveHorizontal className="size-4" aria-hidden />}
      >
        {t('absences.register.fitMonth')}
      </Button>

      <Button
        type="button"
        variant={fullscreen ? 'primary' : 'secondary'}
        disabled={!register}
        onClick={fullscreen ? () => setFullscreen(false) : handleEnterFullscreen}
        icon={
          fullscreen ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )
        }
      >
        {fullscreen ? t('absences.register.exitFullscreen') : t('absences.register.fullscreen')}
      </Button>
    </div>
  );

  const renderRegisterTable = (isFullscreenMode: boolean) => {
    if (!register) return null;
    if (register.rows.length === 0) {
      return (
        <p className="px-4 py-8 text-center text-sm text-neutral-600">
          {t('absences.register.noStudents')}
        </p>
      );
    }
    if (filteredRows.length === 0) {
      return (
        <p className="px-4 py-8 text-center text-sm text-neutral-600">
          {t('absences.register.noAbsentStudents')}
        </p>
      );
    }

    return (
      <div
        ref={isFullscreenMode ? fullscreenScrollRef : inlineScrollRef}
        className={`${
          isFullscreenMode ? 'flex-1 overflow-auto' : 'max-h-[72vh] overflow-auto'
        } overscroll-contain [contain:layout_style] [scrollbar-width:thin]`}
      >
        <table
          style={tableStyle}
          data-compact={zoom < 75 ? 'true' : undefined}
          className="group/tbl w-max min-w-full table-fixed border-separate border-spacing-0 text-[length:var(--reg-font)] tabular-nums"
        >
          <colgroup>
            <col className="w-[var(--reg-idx-w)]" />
            <col className="w-[var(--reg-name-w)]" />
            {register.days.map((dayInfo) => (
              <FragmentDayCols key={dayInfo.day} />
            ))}
            <col className="w-[var(--reg-sum-w)]" />
            <col className="w-[var(--reg-sum-w)]" />
            <col className="w-[var(--reg-total-w)]" />
          </colgroup>

          <RegisterTableHeader days={register.days} labels={tableLabels} />

          <RegisterTableBody
            rows={filteredRows}
            days={register.days}
            leftBadgeLabel={tableLabels.leftBadge}
            morningLabel={tableLabels.shortMorning}
            eveningLabel={tableLabels.shortEvening}
            onInspectCell={handleInspectCell}
          />

          <RegisterTableFooter
            days={register.days}
            dailyTotals={register.dailyTotals}
            totals={register.totals}
            footerTotalLabel={tableLabels.footerTotal}
          />
        </table>
      </div>
    );
  };

  const detailMorningRecords = detail
    ? detail.cell.records.filter((record) => detail.cell.morningPeriods.includes(Number(record.period)))
    : [];
  const detailEveningRecords = detail
    ? detail.cell.records.filter((record) => detail.cell.eveningPeriods.includes(Number(record.period)))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Class selector */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {data.classes.map((schoolClass) => (
          <FilterChip
            key={schoolClass.id}
            label={schoolClass.name}
            active={schoolClass.id === activeClass.id}
            onClick={() => onSelectClass(schoolClass.id)}
          />
        ))}
      </div>

      {/* Controls toolbar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
              <span>{t('reports.month')}</span>
              <div className="flex items-center gap-2">
                <input
                  type="month"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="min-h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-900 tabular-nums focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                {month !== currentMonth ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setMonth(currentMonth)}
                    icon={<Calendar className="size-4" aria-hidden />}
                  >
                    {t('absences.register.thisMonth')}
                  </Button>
                ) : null}
              </div>
            </label>

            <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-sm font-medium text-neutral-700 sm:max-w-xs">
              <span>{t('common.search')}</span>
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute start-3 size-4 text-neutral-400" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('absences.register.searchPlaceholder')}
                  className="min-h-11 w-full rounded-xl border border-neutral-300 bg-white pe-3 ps-9 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
            </label>

            <div className="min-w-[13rem]">
              <SegmentedControl<StudentFilterMode>
                value={filterMode}
                onChange={setFilterMode}
                options={[
                  { id: 'all', label: t('absences.register.filterAll') },
                  { id: 'absentOnly', label: t('absences.register.filterAbsentOnly') },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canAddStudent && onAddStudent ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onAddStudent(activeClass.id)}
                icon={<UserPlus className="size-4" aria-hidden />}
              >
                {t('absences.addStudentButton')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={!register}
              onClick={handlePrint}
              icon={<Printer className="size-4" aria-hidden />}
            >
              {t('absences.register.printPdf')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!register || exporting !== null}
              onClick={() => void handleExportClassExcel()}
              icon={<Download className="size-4" aria-hidden />}
            >
              {exporting === 'class' ? t('absences.register.exporting') : t('absences.register.exportClassExcel')}
            </Button>
            {data.classes.length > 1 ? (
              <Button
                type="button"
                disabled={!validMonth || exporting !== null}
                onClick={() => void handleExportAllClassesExcel()}
                icon={<FileSpreadsheet className="size-4" aria-hidden />}
              >
                {exporting === 'all' ? t('absences.register.exporting') : t('absences.register.exportAllExcel')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Zoom & Fullscreen bar + Summary */}
        {register ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600 tabular-nums">
              <span>
                {t('absences.register.studentsCount')}:{' '}
                <strong className="font-bold text-neutral-900">{register.totals.studentCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('absences.register.schoolDaysCount')}:{' '}
                <strong className="font-bold text-neutral-900">{register.schoolDayCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('absences.register.morningHours')}:{' '}
                <strong className="font-bold text-neutral-900">{register.totals.morningHours}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('absences.register.eveningHours')}:{' '}
                <strong className="font-bold text-neutral-900">{register.totals.eveningHours}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('absences.register.totalHours')}:{' '}
                <strong className="font-bold text-danger-700">{register.totals.totalHours}</strong>
              </span>
            </div>

            {zoomControls}
          </div>
        ) : null}
      </section>

      {!validMonth ? <FormError message={t('validation.invalidDate')} /> : null}

      {/* Official Monthly Register Grid (Inline view) */}
      {register && !fullscreen ? (
        <section className="overflow-hidden rounded-2xl border border-neutral-300 bg-white">
          <div className="bg-[#1f3864] px-4 py-3 text-[#ffffff]">
            <h2 className="text-base font-bold sm:text-lg">
              {t('absences.register.bannerTitle')} — {register.className}
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-neutral-300 bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-800">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                {t('absences.register.institutionLabel')}: {institution.name}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('absences.register.monthLabel')}: {monthDisplay}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('absences.register.classLabel')}: {register.className}
              </span>
            </div>
            <span className="text-neutral-600">
              {t('absences.register.legendText')} ({t('absences.register.eveningFromHint', { time: eveningStartTime })})
            </span>
          </div>

          {renderRegisterTable(false)}
        </section>
      ) : null}

      {/* Fullscreen Portal Overlay */}
      {register && fullscreen
        ? createPortal(
            <div
              role="region"
              aria-label={`${t('absences.register.bannerTitle')} - ${register.className}`}
              className="safe-pt safe-pb safe-px fixed inset-0 z-[70] flex flex-col bg-neutral-50"
            >
              {/* Fullscreen Top Control Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-300 bg-[#1f3864] px-3 py-2 text-[#ffffff]">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="whitespace-nowrap text-sm font-bold sm:text-base">
                    {t('absences.register.bannerTitle')}
                  </h2>
                  {data.classes.length > 1 ? (
                    <select
                      aria-label={t('absences.register.classLabel')}
                      value={activeClass.id}
                      onChange={(event) => onSelectClass(event.target.value)}
                      className="min-h-9 rounded-lg border border-[#475569] bg-[#2b4c7e] px-2.5 text-xs font-bold text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-300"
                    >
                      {data.classes.map((schoolClass) => (
                        <option key={schoolClass.id} value={schoolClass.id}>
                          {schoolClass.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs font-semibold text-neutral-200">{register.className}</span>
                  )}
                  <input
                    type="month"
                    aria-label={t('reports.month')}
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                    className="min-h-9 rounded-lg border border-[#475569] bg-[#2b4c7e] px-2 text-xs font-bold text-[#ffffff] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-300"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {zoomControls}
                </div>
              </div>

              {/* Compact Metadata & Legend Line */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
                  <span>{institution.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{monthDisplay}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t('absences.register.totalHours')}:{' '}
                    <strong className="text-danger-700">{register.totals.totalHours}</strong>
                  </span>
                </div>
                <span className="text-neutral-600">{t('absences.register.legendText')}</span>
              </div>

              {/* Fullscreen Table Canvas */}
              <div className="flex min-h-0 flex-1 flex-col bg-white">{renderRegisterTable(true)}</div>
            </div>,
            document.body,
          )
        : null}

      {/* Day Cell Detail Modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.row.fullName}` : t('absences.register.detailTitle')}
        description={detail ? `${register?.className ?? ''} · ${detail.cell.date}` : undefined}
      >
        {detail ? (
          <div className="flex flex-col gap-4">
            {!detail.isSchoolDay ? (
              <p className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-700">
                {t('absences.register.nonWorkingDayNote')}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-neutral-900">
                {t('absences.register.morningSessionTitle')} ({detail.cell.morningHours})
              </h3>
              {detailMorningRecords.length === 0 ? (
                <p className="text-xs text-neutral-500">{t('absences.register.noMorningAbsences')}</p>
              ) : (
                <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-neutral-50">
                  {detailMorningRecords.map((record) => (
                    <li key={record.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-neutral-900">
                          {t('absences.period', { number: record.period })} ({periodTimeRange(record.period)})
                        </p>
                        <p className="truncate text-neutral-600">{record.subject}</p>
                      </div>
                      <span className="shrink-0 text-neutral-600">
                        {record.justified ? t('absences.justified') : t('absences.unjustified')} ·{' '}
                        {sourceLabel(record.source, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-neutral-900">
                {t('absences.register.eveningSessionTitle')} ({detail.cell.eveningHours})
              </h3>
              {detailEveningRecords.length === 0 ? (
                <p className="text-xs text-neutral-500">{t('absences.register.noEveningAbsences')}</p>
              ) : (
                <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-neutral-50">
                  {detailEveningRecords.map((record) => (
                    <li key={record.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-neutral-900">
                          {t('absences.period', { number: record.period })} ({periodTimeRange(record.period)})
                        </p>
                        <p className="truncate text-neutral-600">{record.subject}</p>
                      </div>
                      <span className="shrink-0 text-neutral-600">
                        {record.justified ? t('absences.justified') : t('absences.unjustified')} ·{' '}
                        {sourceLabel(record.source, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setDetail(null)}>
                {t('common.close')}
              </Button>
              {detail.isSchoolDay ? (
                <Button
                  type="button"
                  onClick={() => {
                    const targetDate = detail.cell.date;
                    setDetail(null);
                    setFullscreen(false);
                    onOpenDayEditor(activeClass.id, targetDate);
                  }}
                  icon={<ExternalLink className="size-4" aria-hidden />}
                >
                  {t('absences.register.openDayEditor')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

const FragmentDayCols = memo(function FragmentDayCols() {
  return (
    <>
      <col className="w-[var(--reg-sub-w)]" />
      <col className="w-[var(--reg-sub-w)]" />
    </>
  );
});

interface TableLabels {
  colIndex: string;
  colFullName: string;
  colDaysHeader: string;
  colMonthlyTotal: string;
  shortMorning: string;
  shortEvening: string;
  colTotal: string;
  footerTotal: string;
  leftBadge: string;
}

const RegisterTableHeader = memo(function RegisterTableHeader({
  days,
  labels,
}: {
  days: RegisterDayInfo[];
  labels: TableLabels;
}) {
  return (
    <thead className="sticky top-0 z-30">
      <tr className="bg-[#1f3864] text-[#ffffff]">
        <th
          rowSpan={3}
          className="sticky ltr:left-0 rtl:right-0 z-40 w-[var(--reg-idx-w)] min-w-[var(--reg-idx-w)] max-w-[var(--reg-idx-w)] border-y border-s border-e border-[#475569] bg-[#1f3864] px-[2px] py-[var(--reg-head-py)] text-center font-bold whitespace-nowrap"
        >
          {labels.colIndex}
        </th>
        <th
          rowSpan={3}
          className="sticky ltr:left-[var(--reg-idx-w)] rtl:right-[var(--reg-idx-w)] z-40 w-[var(--reg-name-w)] min-w-[var(--reg-name-w)] max-w-[var(--reg-name-w)] border-y border-e border-[#475569] bg-[#1f3864] px-[var(--reg-name-px)] py-[var(--reg-head-py)] text-start font-bold whitespace-nowrap"
        >
          {labels.colFullName}
        </th>
        <th
          colSpan={days.length * 2}
          className="border-y border-e border-[#475569] bg-[#1f3864] px-[var(--reg-head-px)] py-[var(--reg-head-py)] text-center font-bold"
        >
          {labels.colDaysHeader}
        </th>
        <th
          colSpan={3}
          rowSpan={2}
          className="border-y border-e border-[#475569] bg-[#1f3864] px-[var(--reg-head-px)] py-[var(--reg-head-py)] text-center font-bold whitespace-nowrap"
        >
          {labels.colMonthlyTotal}
        </th>
      </tr>

      <tr className="bg-[#1f3864] text-[#ffffff]">
        {days.map((dayInfo) => (
          <th
            key={dayInfo.day}
            colSpan={2}
            title={dayInfo.date}
            className={`border-b border-e border-[#475569] px-[var(--reg-head-px)] py-[var(--reg-head-py)] text-center font-bold ${
              dayInfo.isSchoolDay ? 'bg-[#1f3864]' : 'bg-[#334155]'
            }`}
          >
            {dayInfo.day}
          </th>
        ))}
      </tr>

      <tr className="bg-[#2b4c7e] text-[#ffffff]">
        {days.map((dayInfo) => {
          const cls = dayInfo.isSchoolDay ? 'bg-[#2b4c7e]' : 'bg-[#334155]';
          return (
            <FragmentDaySubHeaders
              key={dayInfo.day}
              morningLabel={labels.shortMorning}
              eveningLabel={labels.shortEvening}
              bgClass={cls}
            />
          );
        })}
        <th className="w-[var(--reg-sum-w)] min-w-[var(--reg-sum-w)] border-b border-e border-[#475569] bg-[#2b4c7e] px-[var(--reg-head-px)] py-[var(--reg-head-py)] text-center font-bold whitespace-nowrap">
          {labels.shortMorning}
        </th>
        <th className="w-[var(--reg-sum-w)] min-w-[var(--reg-sum-w)] border-b border-e border-[#475569] bg-[#2b4c7e] px-[var(--reg-head-px)] py-[var(--reg-head-py)] text-center font-bold whitespace-nowrap">
          {labels.shortEvening}
        </th>
        <th className="w-[var(--reg-total-w)] min-w-[var(--reg-total-w)] border-b border-e border-[#475569] bg-[#1e3a5f] px-[var(--reg-head-px)] py-[var(--reg-head-py)] text-center font-bold whitespace-nowrap">
          {labels.colTotal}
        </th>
      </tr>
    </thead>
  );
});

function FragmentDaySubHeaders({
  morningLabel,
  eveningLabel,
  bgClass,
}: {
  morningLabel: string;
  eveningLabel: string;
  bgClass: string;
}) {
  return (
    <>
      <th
        className={`w-[var(--reg-sub-w)] min-w-[var(--reg-sub-w)] border-b border-e border-[#475569] px-0 py-0.5 text-center text-[length:var(--reg-sub-font)] font-bold ${bgClass}`}
      >
        {morningLabel}
      </th>
      <th
        className={`w-[var(--reg-sub-w)] min-w-[var(--reg-sub-w)] border-b border-e border-[#475569] px-0 py-0.5 text-center text-[length:var(--reg-sub-font)] font-bold ${bgClass}`}
      >
        {eveningLabel}
      </th>
    </>
  );
}

const RegisterTableBody = memo(function RegisterTableBody({
  rows,
  days,
  leftBadgeLabel,
  morningLabel,
  eveningLabel,
  onInspectCell,
}: {
  rows: RegisterStudentRow[];
  days: RegisterDayInfo[];
  leftBadgeLabel: string;
  morningLabel: string;
  eveningLabel: string;
  onInspectCell: (rowIdx: number, dayIdx: number) => void;
}) {
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLTableSectionElement>) => {
      const td = (event.target as HTMLElement).closest<HTMLTableCellElement>(
        'td[data-row-idx][data-day-idx]',
      );
      if (!td) return;
      const rowIdx = Number(td.dataset.rowIdx);
      const dayIdx = Number(td.dataset.dayIdx);
      if (!Number.isInteger(rowIdx) || !Number.isInteger(dayIdx)) return;
      onInspectCell(rowIdx, dayIdx);
    },
    [onInspectCell],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTableSectionElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const td = (event.target as HTMLElement).closest<HTMLTableCellElement>(
        'td[data-row-idx][data-day-idx]',
      );
      if (!td) return;
      event.preventDefault();
      const rowIdx = Number(td.dataset.rowIdx);
      const dayIdx = Number(td.dataset.dayIdx);
      if (!Number.isInteger(rowIdx) || !Number.isInteger(dayIdx)) return;
      onInspectCell(rowIdx, dayIdx);
    },
    [onInspectCell],
  );

  return (
    <tbody onClick={handleClick} onKeyDown={handleKeyDown}>
      {rows.map((row, rowIdx) => (
        <RegisterStudentRowItem
          key={row.student.id}
          row={row}
          rowIdx={rowIdx}
          days={days}
          leftBadgeLabel={leftBadgeLabel}
          morningLabel={morningLabel}
          eveningLabel={eveningLabel}
        />
      ))}
    </tbody>
  );
});

const RegisterStudentRowItem = memo(function RegisterStudentRowItem({
  row,
  rowIdx,
  days,
  leftBadgeLabel,
  morningLabel,
  eveningLabel,
}: {
  row: RegisterStudentRow;
  rowIdx: number;
  days: RegisterDayInfo[];
  leftBadgeLabel: string;
  morningLabel: string;
  eveningLabel: string;
}) {
  return (
    <tr className="group hover:bg-neutral-50">
      <td className="sticky ltr:left-0 rtl:right-0 z-20 h-[var(--reg-row-h)] w-[var(--reg-idx-w)] min-w-[var(--reg-idx-w)] max-w-[var(--reg-idx-w)] border-b border-s border-e border-neutral-300 bg-neutral-50 px-[2px] text-center font-bold text-neutral-700 group-hover:bg-neutral-100">
        {row.index}
      </td>
      <td className="sticky ltr:left-[var(--reg-idx-w)] rtl:right-[var(--reg-idx-w)] z-20 h-[var(--reg-row-h)] w-[var(--reg-name-w)] min-w-[var(--reg-name-w)] max-w-[var(--reg-name-w)] border-b border-e border-neutral-300 bg-white px-[var(--reg-name-px)] text-start font-medium text-neutral-900 group-hover:bg-neutral-50">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate" title={row.fullName}>
            <strong className="font-bold">{row.student.lastName}</strong> {row.student.firstName}
          </span>
          {row.hasLeft ? (
            <span className="shrink-0 text-[9px] text-neutral-500 group-data-[compact=true]/tbl:hidden">
              ({leftBadgeLabel})
            </span>
          ) : null}
        </div>
      </td>

      {row.days.map((cellData, dayIdx) => {
        const isSchool = days[dayIdx]?.isSchoolDay ?? true;
        const baseBg = isSchool ? 'bg-white' : 'bg-neutral-100';
        const hasMorning = cellData.morningHours > 0;
        const hasEvening = cellData.eveningHours > 0;
        const ariaPrefix = `${row.fullName} - ${cellData.date}`;

        return (
          <FragmentDayCells
            key={cellData.day}
            rowIdx={rowIdx}
            dayIdx={dayIdx}
            morningHours={hasMorning ? cellData.morningHours : null}
            eveningHours={hasEvening ? cellData.eveningHours : null}
            baseBg={baseBg}
            ariaMorning={`${ariaPrefix} (${morningLabel})`}
            ariaEvening={`${ariaPrefix} (${eveningLabel})`}
          />
        );
      })}

      <td className="h-[var(--reg-row-h)] w-[var(--reg-sum-w)] min-w-[var(--reg-sum-w)] border-b border-e border-neutral-300 bg-neutral-50 px-[2px] text-center font-semibold text-neutral-800">
        {row.morningTotal}
      </td>
      <td className="h-[var(--reg-row-h)] w-[var(--reg-sum-w)] min-w-[var(--reg-sum-w)] border-b border-e border-neutral-300 bg-neutral-50 px-[2px] text-center font-semibold text-neutral-800">
        {row.eveningTotal}
      </td>
      <td
        className={`h-[var(--reg-row-h)] w-[var(--reg-total-w)] min-w-[var(--reg-total-w)] border-b border-e border-neutral-300 px-[2px] text-center font-bold ${
          row.totalHours > 0 ? 'bg-danger-50 text-danger-800' : 'bg-neutral-100 text-neutral-700'
        }`}
      >
        {row.totalHours}
      </td>
    </tr>
  );
});

function FragmentDayCells({
  rowIdx,
  dayIdx,
  morningHours,
  eveningHours,
  baseBg,
  ariaMorning,
  ariaEvening,
}: {
  rowIdx: number;
  dayIdx: number;
  morningHours: number | null;
  eveningHours: number | null;
  baseBg: string;
  ariaMorning: string;
  ariaEvening: string;
}) {
  return (
    <>
      <td
        role="button"
        tabIndex={0}
        data-row-idx={rowIdx}
        data-day-idx={dayIdx}
        aria-label={ariaMorning}
        className={`h-[var(--reg-row-h)] w-[var(--reg-sub-w)] min-w-[var(--reg-sub-w)] cursor-pointer select-none border-b border-e border-neutral-300 p-0 text-center align-middle hover:bg-primary-50/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
          morningHours !== null ? 'bg-danger-50 font-bold text-danger-800' : `${baseBg} text-neutral-400`
        }`}
      >
        {morningHours ?? ''}
      </td>
      <td
        role="button"
        tabIndex={0}
        data-row-idx={rowIdx}
        data-day-idx={dayIdx}
        aria-label={ariaEvening}
        className={`h-[var(--reg-row-h)] w-[var(--reg-sub-w)] min-w-[var(--reg-sub-w)] cursor-pointer select-none border-b border-e border-neutral-300 p-0 text-center align-middle hover:bg-primary-50/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
          eveningHours !== null ? 'bg-danger-50 font-bold text-danger-800' : `${baseBg} text-neutral-400`
        }`}
      >
        {eveningHours ?? ''}
      </td>
    </>
  );
}

const RegisterTableFooter = memo(function RegisterTableFooter({
  days,
  dailyTotals,
  totals,
  footerTotalLabel,
}: {
  days: RegisterDayInfo[];
  dailyTotals: RegisterDailyTotal[];
  totals: ClassAbsenceRegister['totals'];
  footerTotalLabel: string;
}) {
  return (
    <tfoot>
      <tr className="bg-neutral-100 font-bold text-neutral-900">
        <td
          colSpan={2}
          className="sticky ltr:left-0 rtl:right-0 z-20 border-b border-s border-e border-neutral-300 bg-neutral-100 px-[var(--reg-name-px)] py-[var(--reg-footer-py)] text-center"
        >
          {footerTotalLabel}
        </td>
        {dailyTotals.map((dayTotal, dayIdx) => {
          const isSchool = days[dayIdx]?.isSchoolDay ?? true;
          const bg = isSchool ? 'bg-neutral-100' : 'bg-neutral-200';
          return (
            <FragmentDayFooter
              key={dayTotal.day}
              morning={dayTotal.morningHours}
              evening={dayTotal.eveningHours}
              bg={bg}
            />
          );
        })}
        <td className="border-b border-e border-neutral-300 bg-neutral-200 px-[2px] py-[var(--reg-footer-py)] text-center">
          {totals.morningHours}
        </td>
        <td className="border-b border-e border-neutral-300 bg-neutral-200 px-[2px] py-[var(--reg-footer-py)] text-center">
          {totals.eveningHours}
        </td>
        <td className="border-b border-e border-neutral-300 bg-neutral-200 px-[2px] py-[var(--reg-footer-py)] text-center text-danger-800">
          {totals.totalHours}
        </td>
      </tr>
    </tfoot>
  );
});

function FragmentDayFooter({
  morning,
  evening,
  bg,
}: {
  morning: number;
  evening: number;
  bg: string;
}) {
  return (
    <>
      <td className={`border-b border-e border-neutral-300 px-0 py-[var(--reg-footer-py)] text-center ${bg}`}>
        {morning > 0 ? morning : ''}
      </td>
      <td className={`border-b border-e border-neutral-300 px-0 py-[var(--reg-footer-py)] text-center ${bg}`}>
        {evening > 0 ? evening : ''}
      </td>
    </>
  );
}
