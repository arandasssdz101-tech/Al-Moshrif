import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpDown, CheckSquare, FileDown, LayoutGrid, Printer, QrCode, ScanLine, Search, Square, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/StatusBlock';
import { loadStudentWorkspace } from '@/db/students';
import { isCardAbsenceEnabled, updateCardAbsenceEnabled } from '@/db/institutions';
import type { Student } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { CardScanner } from '@/modules/canteen/CardScanner';
import { playScanFeedback } from '@/modules/canteen/scanFeedback';
import { ScannedStudentSheet } from '@/modules/cards/ScannedStudentSheet';
import { StudentIdCard } from '@/modules/cards/StudentIdCard';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { schoolYearForDate } from '@/utils/schoolYear';
import { isStudentActive } from '@/utils/statistics';
import {
  printStudentCardsA4,
  requiredA4Pages,
  sortStudentsForCards,
  toPrintableCard,
  type CardPrintDensity,
  type CardSortOrder,
  type PrintableStudentCard,
} from '@/utils/studentCardsPrint';
import { downloadStudentCardsPdf } from '@/utils/studentCardsPdf';
import { matchStudentFromScan, studentRegistrationNumber } from '@/utils/studentQr';
import { normalizeText } from '@/utils/text';
import { useAsyncData } from '@/utils/useAsyncData';

type PrintScopeMode = 'class' | 'custom';

export function StudentCardsScreen() {
  const { t, i18n } = useTranslation();
  const { user, institution, refresh } = useSession();
  const today = todayIso();
  const cardAbsenceEnabled = isCardAbsenceEnabled(institution);
  const [togglingCardAbsence, setTogglingCardAbsence] = useState(false);
  const workspace = useAsyncData(() => loadStudentWorkspace(institution.id, user.id), [institution.id, user.id]);

  const [scopeMode, setScopeMode] = useState<PrintScopeMode>('class');
  const [density, setDensity] = useState<CardPrintDensity>(10);
  const [sortOrder, setSortOrder] = useState<CardSortOrder>('lastName');
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [schoolYear, setSchoolYear] = useState(() => schoolYearForDate(today));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);
  const [scannedContext, setScannedContext] = useState<{ student: Student; code: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const data = workspace.data;
  const classes = useMemo(() => data?.classes ?? [], [data]);
  const students = useMemo(
    () => (data?.students ?? []).filter((student) => isStudentActive(student, today)),
    [data, today],
  );
  const classNameById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);

  const visibleStudents = useMemo(() => {
    const needle = normalizeText(query);
    const filtered = students.filter((student) => {
      if (classFilter !== null && student.classId !== classFilter) return false;
      if (!needle) return true;
      const haystack = normalizeText(
        `${student.firstName} ${student.lastName} ${student.lastName} ${student.firstName} ${studentRegistrationNumber(student)} ${student.id}`,
      );
      return haystack.includes(needle);
    });
    return sortStudentsForCards(filtered, sortOrder);
  }, [students, classFilter, query, sortOrder]);

  const studentsToPrint = useMemo(() => {
    if (scopeMode === 'custom') {
      const picked = students.filter((student) => selectedIds.has(student.id));
      return sortStudentsForCards(picked, sortOrder);
    }
    return visibleStudents;
  }, [scopeMode, students, selectedIds, visibleStudents, sortOrder]);

  const selectedClassName = classFilter ? classNameById.get(classFilter) ?? '' : '';
  const yearLabel = schoolYear.trim() || schoolYearForDate(today);
  const sheetCount = requiredA4Pages(studentsToPrint.length, density);

  const toggleStudentSelection = (studentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleStudents.forEach((student) => next.add(student.id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleResolveScan = (rawText: string) => {
    const cleaned = rawText.trim();
    if (!cleaned) return;
    setScanError(null);
    const matched = matchStudentFromScan(data?.students ?? [], cleaned, institution.canteenMatchField);
    if (!matched) {
      playScanFeedback('error');
      setScanError(t('cards.scanner.notFound', { code: cleaned.slice(0, 60) }));
      return;
    }
    playScanFeedback('success');
    setCameraOpen(false);
    setScanInput('');
    setScannedContext({ student: matched, code: cleaned });
  };

  const handleHardwareScanSubmit = (event: FormEvent) => {
    event.preventDefault();
    handleResolveScan(scanInput);
  };

  const handleToggleCardAbsence = async () => {
    if (user.role !== 'head' || togglingCardAbsence) return;
    setTogglingCardAbsence(true);
    setScanError(null);
    try {
      await updateCardAbsenceEnabled(institution.id, !cardAbsenceEnabled, user.id);
      await refresh();
    } catch (cause) {
      setScanError(t(errorKey(cause)));
    } finally {
      setTogglingCardAbsence(false);
    }
  };

  const handlePrintCards = async (cards: PrintableStudentCard[], title: string) => {
    if (cards.length === 0 || printing) return;
    setPrinting(true);
    setScanError(null);
    try {
      await printStudentCardsA4(cards, title, i18n.language, density);
    } catch {
      setScanError(t('cards.printFailed'));
    } finally {
      setPrinting(false);
    }
  };

  const buildBatchCardsAndTitle = () => {
    const cards = studentsToPrint.map((student) =>
      toPrintableCard(
        student,
        classNameById.get(student.classId) ?? t('students.unknownClass'),
        institution.name,
        yearLabel,
        institution.directorate,
      ),
    );
    const title =
      scopeMode === 'custom'
        ? t('cards.printCustomTitle')
        : selectedClassName
          ? `${t('cards.title')} - ${selectedClassName}`
          : t('cards.title');
    return { cards, title };
  };

  const handlePrintBatch = () => {
    const { cards, title } = buildBatchCardsAndTitle();
    void handlePrintCards(cards, title);
  };

  const handleDownloadPdfCards = async (cards: PrintableStudentCard[], title: string) => {
    if (cards.length === 0 || downloadingPdf) return;
    setDownloadingPdf(true);
    setScanError(null);
    try {
      await downloadStudentCardsPdf(cards, title, density);
    } catch {
      setScanError(t('cards.pdfFailed'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadPdfBatch = () => {
    const { cards, title } = buildBatchCardsAndTitle();
    void handleDownloadPdfCards(cards, title);
  };

  const handlePrintSingle = (card: PrintableStudentCard) => {
    void handlePrintCards([card], `${t('cards.cardHeader')} - ${card.fullName}`);
  };

  const handleDownloadPdfSingle = (card: PrintableStudentCard) => {
    void handleDownloadPdfCards([card], `${t('cards.cardHeader')} - ${card.fullName}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl text-neutral-900">{t('cards.title')}</h1>
          <p className="text-base text-neutral-600">{t('cards.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCameraOpen(true)} icon={<ScanLine className="size-5" aria-hidden />}>
            {t('cards.scanCamera')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleDownloadPdfBatch}
            disabled={studentsToPrint.length === 0 || downloadingPdf}
            icon={<FileDown className="size-5" aria-hidden />}
          >
            {downloadingPdf
              ? t('cards.generatingPdf')
              : sheetCount > 0
                ? t('cards.downloadPdfWithPages', { pages: sheetCount })
                : t('cards.downloadPdf')}
          </Button>
          <Button
            variant="secondary"
            onClick={handlePrintBatch}
            disabled={studentsToPrint.length === 0 || printing}
            icon={<Printer className="size-5" aria-hidden />}
          >
            {scopeMode === 'custom'
              ? t('cards.printSelectedAction', { count: studentsToPrint.length, pages: sheetCount })
              : selectedClassName
                ? t('cards.printClassWithPages', {
                    name: selectedClassName,
                    count: studentsToPrint.length,
                    pages: sheetCount,
                  })
                : t('cards.printVisibleWithPages', { count: studentsToPrint.length, pages: sheetCount })}
          </Button>
        </div>
      </header>

      {/* USB / Bluetooth Hardware QR Scanner + Quick Paste Bar + Card Absence Toggle */}
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <form onSubmit={handleHardwareScanSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <QrCode className="size-5 shrink-0 text-primary-700" aria-hidden />
            <input
              ref={scanInputRef}
              type="text"
              value={scanInput}
              onChange={(event) => {
                setScanInput(event.target.value);
                if (scanError) setScanError(null);
              }}
              placeholder={t('cards.hardwareScannerPlaceholder')}
              aria-label={t('cards.hardwareScannerPlaceholder')}
              className="min-h-11 w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!scanInput.trim()}>
            {t('cards.lookupCode')}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-neutral-700">{t('absences.cardAbsence.title')}:</span>
            <span
              className={`rounded-md px-2 py-0.5 font-semibold ${
                cardAbsenceEnabled ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {cardAbsenceEnabled ? t('absences.cardAbsence.enabled') : t('absences.cardAbsence.disabled')}
            </span>
          </div>
          {user.role === 'head' ? (
            <button
              type="button"
              role="switch"
              aria-checked={cardAbsenceEnabled}
              aria-label={t('absences.cardAbsence.toggleLabel')}
              disabled={togglingCardAbsence}
              onClick={() => void handleToggleCardAbsence()}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${
                cardAbsenceEnabled ? 'bg-primary-600' : 'bg-neutral-300'
              }`}
            >
              <span
                className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
                  cardAbsenceEnabled ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'
                }`}
              />
            </button>
          ) : null}
        </div>
      </div>

      <FormError message={scanError} />

      {workspace.loading && !data ? (
        <LoadingState />
      ) : workspace.error ? (
        <ErrorState message={t(errorKey(workspace.error))} onRetry={workspace.reload} />
      ) : students.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" aria-hidden />}
          title={t('cards.emptyTitle')}
          body={t('cards.emptyBody')}
        />
      ) : (
        <>
          {/* Economical A4 Batch Print Settings Panel */}
          <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Print Scope Mode */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-neutral-600">{t('cards.printScope.label')}</span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
                  <button
                    type="button"
                    onClick={() => setScopeMode('class')}
                    className={`min-h-10 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      scopeMode === 'class'
                        ? 'bg-white text-neutral-900 shadow-sm'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {t('cards.printScope.byClass')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeMode('custom')}
                    className={`min-h-10 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      scopeMode === 'custom'
                        ? 'bg-white text-neutral-900 shadow-sm'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {t('cards.printScope.custom')}
                  </button>
                </div>
              </div>

              {/* A4 Density Mode */}
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-600">
                  <LayoutGrid className="size-3.5 text-primary-700" aria-hidden />
                  <span>{t('cards.density.label')}</span>
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
                  <button
                    type="button"
                    onClick={() => setDensity(10)}
                    className={`min-h-10 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      density === 10
                        ? 'bg-white text-neutral-900 shadow-sm'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {t('cards.density.tenPerPage')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDensity(8)}
                    className={`min-h-10 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      density === 8
                        ? 'bg-white text-neutral-900 shadow-sm'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {t('cards.density.eightPerPage')}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
              <label className="flex items-center gap-2">
                <ArrowUpDown className="size-3.5 text-neutral-500" aria-hidden />
                <span className="font-semibold">{t('cards.sort.label')}:</span>
                <select
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as CardSortOrder)}
                  className="min-h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-900 focus:border-primary-500 focus:outline-none"
                >
                  <option value="lastName">{t('cards.sort.lastName')}</option>
                  <option value="firstName">{t('cards.sort.firstName')}</option>
                  <option value="regNumber">{t('cards.sort.regNumber')}</option>
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral-600">
                <span className="tabular-nums font-semibold text-neutral-900">
                  {t('cards.paperSummary', { cards: studentsToPrint.length, pages: sheetCount })}
                </span>
                <span aria-hidden>·</span>
                <span>{t('cards.inkSavingNote')}</span>
              </div>
            </div>

            {scopeMode === 'custom' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                <span className="text-xs font-medium text-neutral-600">
                  {t('cards.customHint', { count: selectedIds.size })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    disabled={visibleStudents.length === 0}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <CheckSquare className="size-3.5 text-primary-700" aria-hidden />
                    <span>{t('cards.selectVisible')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <Square className="size-3.5 text-neutral-400" aria-hidden />
                    <span>{t('cards.clearSelection')}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Search, School Year & Class Filter controls */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem]">
              <label className="flex min-h-12 items-center gap-3 rounded-xl bg-white px-4 ring-1 ring-neutral-300 transition focus-within:ring-4 focus-within:ring-primary-500/15">
                <Search className="size-5 shrink-0 text-neutral-400" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('cards.searchPlaceholder')}
                  className="min-h-12 w-full bg-transparent text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                />
              </label>
              <label className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-white px-3.5 ring-1 ring-neutral-300 focus-within:ring-4 focus-within:ring-primary-500/15">
                <span className="shrink-0 text-xs font-medium text-neutral-500">{t('cards.schoolYear')}</span>
                <input
                  type="text"
                  dir="ltr"
                  value={schoolYear}
                  onChange={(event) => setSchoolYear(event.target.value)}
                  className="w-full bg-transparent text-end font-mono text-sm font-semibold text-neutral-900 tabular-nums focus:outline-none"
                />
              </label>
            </div>

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              <FilterChip
                label={t('students.allClasses')}
                active={classFilter === null}
                onClick={() => setClassFilter(null)}
              />
              {classes.map((schoolClass) => (
                <FilterChip
                  key={schoolClass.id}
                  label={schoolClass.name}
                  active={classFilter === schoolClass.id}
                  onClick={() => setClassFilter(schoolClass.id)}
                />
              ))}
            </div>
          </div>

          {visibleStudents.length === 0 ? (
            <p className="rounded-2xl border border-neutral-200 bg-white px-6 py-10 text-center text-base text-neutral-500">
              {t('students.noMatches')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">
                <span className="tabular-nums">{t('cards.resultCount', { count: visibleStudents.length })}</span>
                <span>
                  {density === 10 ? t('cards.printA4Hint10') : t('cards.printA4Hint')}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visibleStudents.map((student) => {
                  const classNameLabel = classNameById.get(student.classId) ?? t('students.unknownClass');
                  return (
                    <StudentIdCard
                      key={student.id}
                      student={student}
                      classNameLabel={classNameLabel}
                      institutionName={institution.name}
                      directorate={institution.directorate}
                      schoolYear={yearLabel}
                      highlighted={scannedContext?.student.id === student.id}
                      selectable={scopeMode === 'custom'}
                      selected={selectedIds.has(student.id)}
                      onToggleSelect={() => toggleStudentSelection(student.id)}
                      onSelect={() => setActiveStudent(student)}
                      onPrintSingle={handlePrintSingle}
                      onDownloadPdfSingle={handleDownloadPdfSingle}
                    />
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Single student card showcase modal */}
      {activeStudent ? (
        <Modal
          open
          title={t('cards.singleCardTitle')}
          onClose={() => setActiveStudent(null)}
        >
          <div className="flex flex-col gap-4">
            <StudentIdCard
              student={activeStudent}
              classNameLabel={classNameById.get(activeStudent.classId) ?? t('students.unknownClass')}
              institutionName={institution.name}
              directorate={institution.directorate}
              schoolYear={yearLabel}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                fullWidth
                onClick={() =>
                  handlePrintSingle(
                    toPrintableCard(
                      activeStudent,
                      classNameById.get(activeStudent.classId) ?? t('students.unknownClass'),
                      institution.name,
                      yearLabel,
                      institution.directorate,
                    ),
                  )
                }
                icon={<Printer className="size-4" aria-hidden />}
              >
                {t('cards.printSingle')}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                disabled={downloadingPdf}
                onClick={() =>
                  handleDownloadPdfSingle(
                    toPrintableCard(
                      activeStudent,
                      classNameById.get(activeStudent.classId) ?? t('students.unknownClass'),
                      institution.name,
                      yearLabel,
                      institution.directorate,
                    ),
                  )
                }
                icon={<FileDown className="size-4" aria-hidden />}
              >
                {downloadingPdf ? t('cards.generatingPdf') : t('cards.downloadPdf')}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  const chosen = activeStudent;
                  setActiveStudent(null);
                  setScannedContext({ student: chosen, code: chosen.id });
                }}
              >
                {t('cards.openQuickActions')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Scanned student instant profile & one-tap offline actions */}
      {scannedContext ? (
        <ScannedStudentSheet
          student={scannedContext.student}
          classNameLabel={classNameById.get(scannedContext.student.classId) ?? t('students.unknownClass')}
          allStudents={data?.students ?? []}
          scannedCode={scannedContext.code}
          onClose={() => setScannedContext(null)}
          onViewCard={() => {
            const target = scannedContext.student;
            setScannedContext(null);
            setActiveStudent(target);
          }}
          onPrintCard={() =>
            handlePrintSingle(
              toPrintableCard(
                scannedContext.student,
                classNameById.get(scannedContext.student.classId) ?? t('students.unknownClass'),
                institution.name,
                yearLabel,
                institution.directorate,
              ),
            )
          }
        />
      ) : null}

      {/* Camera QR scanner */}
      {cameraOpen ? (
        <CardScanner
          paused={scannedContext !== null}
          onDetect={handleResolveScan}
          onManual={() => {
            setCameraOpen(false);
            setTimeout(() => scanInputRef.current?.focus(), 50);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}
