import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { loadAbsenceWorkspace } from '@/db/absences';
import { canAccessClass } from '@/db/access';
import type { Student } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { AbsenceRegisterView } from '@/modules/absences/AbsenceRegisterView';
import { AddStudentFromAbsenceModal } from '@/modules/absences/AddStudentFromAbsenceModal';
import { ContinuousAbsencesView } from '@/modules/absences/ContinuousAbsencesView';
import { ReportsView } from '@/modules/absences/ReportsView';
import { StudentAbsencesView } from '@/modules/absences/StudentAbsencesView';
import { TeacherAbsencesView } from '@/modules/absences/TeacherAbsencesView';
import { subscribeAppDataChanged } from '@/utils/dataEvents';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { useAsyncData } from '@/utils/useAsyncData';

type Section = 'students' | 'register' | 'continuous' | 'teachers' | 'reports';

export function AbsencesScreen() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const workspace = useAsyncData(() => loadAbsenceWorkspace(institution.id, user.id), [institution.id, user.id]);
  const [section, setSection] = useState<Section>('students');
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [addStudentClassId, setAddStudentClassId] = useState<string | null>(null);
  const [addedNotice, setAddedNotice] = useState<string | null>(null);
  const data = workspace.data;
  const reloadWorkspace = workspace.reload;

  useEffect(() => {
    return subscribeAppDataChanged(['students', 'absences', 'timetable', 'sync'], () => {
      reloadWorkspace();
    });
  }, [reloadWorkspace]);

  const editableClasses = useMemo(() => {
    if (!data) return [];
    const studentAccess = data.studentAccess ?? data.access;
    if (!studentAccess.canEdit) return [];
    return data.classes.filter((item) => canAccessClass(studentAccess, item.id));
  }, [data]);

  if (workspace.loading && !data) return <LoadingState />;
  if (workspace.error || !data) {
    return <ErrorState message={t(errorKey(workspace.error))} onRetry={workspace.reload} />;
  }

  const isHead = data.access.isHead;
  const canAddStudent = editableClasses.length > 0;
  const activeSection: Section = !isHead && section === 'teachers' ? 'students' : section;
  const options: { id: Section; label: string }[] = [
    { id: 'students', label: t('absences.sections.students') },
    { id: 'register', label: t('absences.sections.register') },
    { id: 'continuous', label: t('absences.sections.continuous') },
    ...(isHead ? [{ id: 'teachers' as const, label: t('absences.sections.teachers') }] : []),
    { id: 'reports', label: t('absences.sections.reports') },
  ];

  const handleSectionChange = (next: Section) => {
    setSection(next);
    workspace.reload();
  };

  const handleOpenDayEditor = (classId: string, date: string) => {
    setSelectedClassId(classId);
    setSelectedDate(date);
    setSection('students');
    workspace.reload();
  };

  const handleOpenAddStudent = (preferredClassId?: string | null) => {
    setAddedNotice(null);
    setAddStudentClassId(preferredClassId ?? selectedClassId ?? editableClasses[0]?.id ?? null);
    setAddStudentOpen(true);
  };

  const handleStudentAdded = (student: Student) => {
    setSelectedClassId(student.classId);
    const className = data.classes.find((item) => item.id === student.classId)?.name ?? '';
    setAddedNotice(
      t('absences.addStudentSuccess', {
        name: `${student.lastName} ${student.firstName}`.trim(),
        className,
      }),
    );
    workspace.reload();
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl text-neutral-900">{t('absences.title')}</h1>
        <p className="text-base text-neutral-600">{t('absences.subtitle')}</p>
      </header>

      <SegmentedControl<Section> options={options} value={activeSection} onChange={handleSectionChange} />

      {addedNotice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm font-semibold text-success-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            <span>{addedNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setAddedNotice(null)}
            className="shrink-0 text-xs font-bold underline"
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {activeSection === 'students' ? (
        <StudentAbsencesView
          data={data}
          onSaved={workspace.reload}
          selectedClassId={selectedClassId}
          onSelectClass={setSelectedClassId}
          date={selectedDate}
          onDateChange={setSelectedDate}
          canAddStudent={canAddStudent}
          onAddStudent={handleOpenAddStudent}
        />
      ) : null}
      {activeSection === 'register' ? (
        <AbsenceRegisterView
          data={data}
          selectedClassId={selectedClassId}
          onSelectClass={setSelectedClassId}
          onOpenDayEditor={handleOpenDayEditor}
          canAddStudent={canAddStudent}
          onAddStudent={handleOpenAddStudent}
        />
      ) : null}
      {activeSection === 'continuous' ? <ContinuousAbsencesView data={data} onChanged={workspace.reload} /> : null}
      {activeSection === 'teachers' ? <TeacherAbsencesView data={data} onChanged={workspace.reload} /> : null}
      {activeSection === 'reports' ? <ReportsView data={data} /> : null}

      <AddStudentFromAbsenceModal
        open={addStudentOpen}
        classes={editableClasses}
        defaultClassId={addStudentClassId}
        onClose={() => setAddStudentOpen(false)}
        onAdded={handleStudentAdded}
      />
    </div>
  );
}
