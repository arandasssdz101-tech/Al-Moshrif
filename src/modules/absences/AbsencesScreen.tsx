import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { loadAbsenceWorkspace } from '@/db/absences';
import { useSession } from '@/modules/auth/AuthContext';
import { ContinuousAbsencesView } from '@/modules/absences/ContinuousAbsencesView';
import { ReportsView } from '@/modules/absences/ReportsView';
import { StudentAbsencesView } from '@/modules/absences/StudentAbsencesView';
import { TeacherAbsencesView } from '@/modules/absences/TeacherAbsencesView';
import { errorKey } from '@/utils/errors';
import { useAsyncData } from '@/utils/useAsyncData';

type Section = 'students' | 'continuous' | 'teachers' | 'reports';

export function AbsencesScreen() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const workspace = useAsyncData(() => loadAbsenceWorkspace(institution.id, user.id), [institution.id, user.id]);
  const [section, setSection] = useState<Section>('students');
  const data = workspace.data;

  if (workspace.loading && !data) return <LoadingState />;
  if (workspace.error || !data) {
    return <ErrorState message={t(errorKey(workspace.error))} onRetry={workspace.reload} />;
  }

  const isHead = data.access.isHead;
  const activeSection: Section = !isHead && section === 'teachers' ? 'students' : section;
  const options: { id: Section; label: string }[] = [
    { id: 'students', label: t('absences.sections.students') },
    { id: 'continuous', label: t('absences.sections.continuous') },
    ...(isHead ? [{ id: 'teachers' as const, label: t('absences.sections.teachers') }] : []),
    { id: 'reports', label: t('absences.sections.reports') },
  ];

  const handleSectionChange = (next: Section) => {
    setSection(next);
    workspace.reload();
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl text-neutral-900">{t('absences.title')}</h1>
        <p className="text-base text-neutral-600">{t('absences.subtitle')}</p>
      </header>

      <SegmentedControl<Section> options={options} value={activeSection} onChange={handleSectionChange} />

      {activeSection === 'students' ? <StudentAbsencesView data={data} onSaved={workspace.reload} /> : null}
      {activeSection === 'continuous' ? <ContinuousAbsencesView data={data} onChanged={workspace.reload} /> : null}
      {activeSection === 'teachers' ? <TeacherAbsencesView data={data} onChanged={workspace.reload} /> : null}
      {activeSection === 'reports' ? <ReportsView data={data} /> : null}
    </div>
  );
}
