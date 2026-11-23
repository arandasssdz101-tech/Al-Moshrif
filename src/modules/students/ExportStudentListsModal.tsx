import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import type { SchoolClass, Student } from '@/db/types';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { schoolYearForDate } from '@/utils/schoolYear';
import { isStudentActive } from '@/utils/statistics';
import {
  buildClassStudentLists,
  downloadStudentListsExcel,
  downloadStudentListsPdf,
  type StudentListExportLabels,
} from '@/utils/studentListsExport';

interface ExportStudentListsModalProps {
  open: boolean;
  classes: SchoolClass[];
  students: Student[];
  initialClassId: string | null;
  institutionName: string;
  directorate?: string;
  onClose: () => void;
}

const ALL_CLASSES_VALUE = '__all__';

export function ExportStudentListsModal({
  open,
  classes,
  students,
  initialClassId,
  institutionName,
  directorate,
  onClose,
}: ExportStudentListsModalProps) {
  const { t, i18n } = useTranslation();
  const [selectedClass, setSelectedClass] = useState<string>(initialClassId ?? ALL_CLASSES_VALUE);
  const [includeLeft, setIncludeLeft] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedClass(initialClassId ?? ALL_CLASSES_VALUE);
      setIncludeLeft(false);
      setError(null);
      setExporting(null);
    }
  }, [open, initialClassId]);

  const today = todayIso();

  const labels = useMemo<StudentListExportLabels>(
    () => ({
      columns: {
        index: t('students.exportLists.columns.index'),
        lastName: t('students.exportLists.columns.lastName'),
        firstName: t('students.exportLists.columns.firstName'),
        dateOfBirth: t('students.exportLists.columns.dateOfBirth'),
        placeOfBirth: t('students.exportLists.columns.placeOfBirth'),
        boardingStatus: t('students.exportLists.columns.boardingStatus'),
        repeater: t('students.exportLists.columns.repeater'),
        gender: t('students.exportLists.columns.gender'),
      },
      gender: {
        male: t('students.gender.male'),
        female: t('students.gender.female'),
      },
      boarding: {
        'half-boarder': t('students.boarding.half-boarder'),
        external: t('students.boarding.external'),
      },
      yes: t('common.yes'),
      no: t('common.no'),
      listHeading: (className: string) => t('students.exportLists.listHeading', { className }),
      continuation: t('students.exportLists.continuation'),
      schoolYearLabel: t('students.exportLists.schoolYear'),
      exportDateLabel: t('students.exportLists.exportDate'),
      institutionLabel: t('students.exportLists.institutionLabel'),
      pageOf: (page: number, total: number) => t('students.exportLists.pageOf', { page, total }),
      totals: {
        total: t('students.exportLists.totals.total'),
        males: t('students.exportLists.totals.males'),
        females: t('students.exportLists.totals.females'),
        halfBoarders: t('students.exportLists.totals.halfBoarders'),
        externals: t('students.exportLists.totals.externals'),
        repeaters: t('students.exportLists.totals.repeaters'),
      },
      fileSinglePrefix: t('students.exportLists.fileSinglePrefix'),
      fileAllPrefix: t('students.exportLists.fileAllPrefix'),
    }),
    [t],
  );

  const countByClassId = useMemo(() => {
    const map = new Map<string, number>();
    for (const student of students) {
      if (!includeLeft && !isStudentActive(student, today)) continue;
      map.set(student.classId, (map.get(student.classId) ?? 0) + 1);
    }
    return map;
  }, [students, includeLeft, today]);

  const lists = useMemo(
    () =>
      buildClassStudentLists({
        classes,
        students,
        selectedClassId: selectedClass === ALL_CLASSES_VALUE ? null : selectedClass,
        includeLeft,
        today,
        lang: i18n.language,
        labels,
      }),
    [classes, students, selectedClass, includeLeft, today, i18n.language, labels],
  );

  const totalStudents = useMemo(
    () => lists.reduce((sum, item) => sum + item.rows.length, 0),
    [lists],
  );

  const meta = useMemo(
    () => ({
      institutionName,
      directorate,
      schoolYear: schoolYearForDate(today),
      exportDate: today,
      lang: i18n.language,
    }),
    [institutionName, directorate, today, i18n.language],
  );

  const handleExport = async (format: 'pdf' | 'excel') => {
    if (lists.length === 0) return;
    setExporting(format);
    setError(null);
    try {
      if (format === 'pdf') {
        await downloadStudentListsPdf(lists, meta, labels);
      } else {
        await downloadStudentListsExcel(lists, meta, labels);
      }
      onClose();
    } catch (exportError) {
      setError(t(errorKey(exportError)));
    } finally {
      setExporting(null);
    }
  };

  return (
    <Modal
      open={open}
      title={t('students.exportLists.title')}
      description={t('students.exportLists.subtitle')}
      onClose={exporting ? () => undefined : onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="export-class-select" className="text-sm font-medium text-neutral-700">
            {t('students.exportLists.classLabel')}
          </label>
          <select
            id="export-class-select"
            value={selectedClass}
            onChange={(event) => {
              setSelectedClass(event.target.value);
              setError(null);
            }}
            disabled={exporting !== null}
            className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base text-neutral-900 transition focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/15"
          >
            <option value={ALL_CLASSES_VALUE}>{t('students.exportLists.allClassesOption')}</option>
            {classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>
                {schoolClass.name} ({countByClassId.get(schoolClass.id) ?? 0})
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={includeLeft}
            onChange={(event) => setIncludeLeft(event.target.checked)}
            disabled={exporting !== null}
            className="size-4 shrink-0 rounded border-neutral-300 accent-primary-600"
          />
          <span>{t('students.exportLists.includeLeft')}</span>
        </label>

        <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-sm">
          {lists.length > 0 ? (
            <p className="font-semibold text-neutral-900">
              {t('students.exportLists.summary', {
                classes: lists.length,
                students: totalStudents,
              })}
            </p>
          ) : (
            <p className="font-medium text-warning-700">{t('students.exportLists.emptyClass')}</p>
          )}
          <p className="text-xs text-neutral-500">{t('students.exportLists.includedFields')}</p>
        </div>

        <FormError message={error} />

        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            fullWidth
            disabled={exporting !== null || lists.length === 0}
            onClick={() => handleExport('pdf')}
            icon={<FileText className="size-5" aria-hidden />}
          >
            {exporting === 'pdf'
              ? t('students.exportLists.exporting')
              : t('students.exportLists.exportPdf')}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            disabled={exporting !== null || lists.length === 0}
            onClick={() => handleExport('excel')}
            icon={<FileSpreadsheet className="size-5" aria-hidden />}
          >
            {exporting === 'excel'
              ? t('students.exportLists.exporting')
              : t('students.exportLists.exportExcel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
