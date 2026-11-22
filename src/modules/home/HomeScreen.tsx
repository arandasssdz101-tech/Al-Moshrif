import { useMemo, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  DoorOpen,
  GraduationCap,
  LayoutDashboard,
  QrCode,
  Search,
  UserCheck,
  UserRoundPlus,
  Utensils,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/ui/CopyButton';
import { ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import { db } from '@/db/database';
import { listSupervisors } from '@/db/users';
import { useSession } from '@/modules/auth/AuthContext';
import type { TabId } from '@/modules/shell/AppShell';
import { weekdayName } from '@/utils/calendar';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { formatInviteCode } from '@/utils/invite';
import { useAsyncData } from '@/utils/useAsyncData';

interface HomeScreenProps {
  onNavigate: (tab: TabId) => void;
  hasCanteen: boolean;
}

interface HomeOverview {
  studentsCount: number;
  classesCount: number;
  todayAbsencesCount: number;
  todayCanteenCount: number;
}

async function loadHomeOverview(institutionId: string, today: string): Promise<HomeOverview> {
  const [students, classes, absences, canteenEntries] = await Promise.all([
    db.students.where('institutionId').equals(institutionId).toArray(),
    db.classes.where('institutionId').equals(institutionId).toArray(),
    db.studentAbsences.where('institutionId').equals(institutionId).toArray(),
    db.canteenEntries.where('institutionId').equals(institutionId).toArray(),
  ]);

  const activeStudents = students.filter((item) => item.deletedAt === null);
  const activeClasses = classes.filter((item) => item.deletedAt === null);
  const absentStudentIds = new Set(
    absences
      .filter((item) => item.deletedAt === null && item.date === today)
      .map((item) => item.studentId),
  );
  const acceptedCanteenToday = canteenEntries.filter(
    (item) => item.deletedAt === null && item.date === today && item.result === 'accepted',
  );

  return {
    studentsCount: activeStudents.length,
    classesCount: activeClasses.length,
    todayAbsencesCount: absentStudentIds.size,
    todayCanteenCount: acceptedCanteenToday.length,
  };
}

export function HomeScreen({ onNavigate, hasCanteen }: HomeScreenProps) {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const isHead = user.role === 'head';
  const today = todayIso();

  const overview = useAsyncData(
    () => loadHomeOverview(institution.id, today),
    [institution.id, today],
  );

  const supervisors = useAsyncData(
    () => (isHead ? listSupervisors(institution.id) : Promise.resolve([])),
    [institution.id, isHead],
  );

  const pendingCount = useMemo(
    () => supervisors.data?.filter((item) => item.status === 'pending').length ?? 0,
    [supervisors.data],
  );
  const approvedCount = useMemo(
    () => supervisors.data?.filter((item) => item.status === 'approved').length ?? 0,
    [supervisors.data],
  );

  const workingDays = [...institution.workingDays]
    .sort((a, b) => a - b)
    .map((day) => weekdayName(day, i18n.language))
    .join(' · ');
  const inviteCode = formatInviteCode(institution.inviteCode);

  const quickLinks: { id: TabId; label: string; icon: ReactNode; tone: keyof typeof TONE_CLASSES }[] = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard className="size-5" aria-hidden />, tone: 'primary' },
    { id: 'students', label: t('nav.students'), icon: <GraduationCap className="size-5" aria-hidden />, tone: 'primary' },
    { id: 'cards', label: t('nav.cards'), icon: <QrCode className="size-5" aria-hidden />, tone: 'primary' },
    { id: 'absences', label: t('nav.absences'), icon: <ClipboardList className="size-5" aria-hidden />, tone: 'warning' },
    { id: 'timetable', label: t('nav.timetable'), icon: <CalendarDays className="size-5" aria-hidden />, tone: 'secondary' },
    ...(hasCanteen
      ? [{ id: 'canteen' as const, label: t('nav.canteen'), icon: <Utensils className="size-5" aria-hidden />, tone: 'success' as const }]
      : []),
    { id: 'statistics', label: t('nav.statistics'), icon: <BarChart3 className="size-5" aria-hidden />, tone: 'accent' },
    { id: 'search', label: t('nav.search'), icon: <Search className="size-5" aria-hidden />, tone: 'primary' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <span className="w-fit rounded-full bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700">
          {isHead ? t('home.roleHead') : t('home.roleSupervisor')}
        </span>
        <h1 className="text-3xl text-neutral-900">{t('home.greeting', { name: user.name })}</h1>
        <p className="text-base text-neutral-600">{t('home.greetingSubtitle')}</p>
      </section>

      {overview.data ? (
        <section className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<GraduationCap className="size-5" aria-hidden />}
            label={t('home.studentsCount')}
            value={String(overview.data.studentsCount)}
            tone="primary"
            onClick={() => onNavigate('students')}
          />
          <StatCard
            icon={<DoorOpen className="size-5" aria-hidden />}
            label={t('home.classesCount')}
            value={String(overview.data.classesCount)}
            tone="secondary"
            onClick={() => onNavigate('students')}
          />
          <StatCard
            icon={<ClipboardList className="size-5" aria-hidden />}
            label={t('home.todayAbsences')}
            value={String(overview.data.todayAbsencesCount)}
            tone="warning"
            onClick={() => onNavigate('absences')}
          />
          {hasCanteen ? (
            <StatCard
              icon={<Utensils className="size-5" aria-hidden />}
              label={t('home.todayCanteen')}
              value={String(overview.data.todayCanteenCount)}
              tone="success"
              onClick={() => onNavigate('canteen')}
            />
          ) : (
            <StatCard
              icon={<CalendarDays className="size-5" aria-hidden />}
              label={t('home.holidays')}
              value={String(institution.holidays.length)}
              tone="accent"
            />
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-500">{t('home.quickActions')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {quickLinks.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className="flex items-center gap-3 rounded-2xl bg-white p-4 text-start shadow-sm ring-1 ring-neutral-200 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONE_CLASSES[item.tone]}`}>
                {item.icon}
              </span>
              <span className="truncate text-sm font-semibold text-neutral-900">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      {isHead ? (
        <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-neutral-500">{t('home.inviteCode')}</span>
              <span className="font-mono text-2xl font-bold tracking-widest text-neutral-900" dir="ltr">
                {inviteCode}
              </span>
            </div>
            <CopyButton value={inviteCode} />
          </div>
          <p className="text-sm text-neutral-600">{t('home.inviteCodeHint')}</p>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <StatCard icon={<DoorOpen className="size-5" aria-hidden />} label={t('home.rooms')} value={String(institution.rooms)} tone="primary" />
        <StatCard
          icon={<CalendarDays className="size-5" aria-hidden />}
          label={t('home.holidays')}
          value={String(institution.holidays.length)}
          tone="accent"
        />
        <div className="col-span-2">
          <StatCard
            icon={<CalendarDays className="size-5" aria-hidden />}
            label={t('home.workingDays')}
            value={workingDays || t('home.noWorkingDays')}
            tone="secondary"
            wide
          />
        </div>
      </section>

      {isHead ? (
        supervisors.loading ? (
          <LoadingState />
        ) : supervisors.error ? (
          <ErrorState message={t(errorKey(supervisors.error))} onRetry={supervisors.reload} />
        ) : (
          <section className="grid grid-cols-2 gap-3">
            <StatCard icon={<UserCheck className="size-5" aria-hidden />} label={t('home.supervisors')} value={String(approvedCount)} tone="success" />
            <button
              type="button"
              onClick={() => onNavigate('supervisors')}
              className="flex flex-col gap-3 rounded-2xl bg-white p-5 text-start shadow-sm ring-1 ring-neutral-200 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-warning-50 text-warning-700">
                <UserRoundPlus className="size-5" aria-hidden />
              </span>
              <span className="text-sm text-neutral-600">{t('home.pending')}</span>
              <span className="flex w-full items-center justify-between gap-2 text-2xl font-bold text-neutral-900">
                {pendingCount}
                <span className="text-sm font-medium text-primary-700">{t('home.reviewPending')}</span>
              </span>
            </button>
          </section>
        )
      ) : null}
    </div>
  );
}

const TONE_CLASSES = {
  primary: 'bg-primary-50 text-primary-700',
  secondary: 'bg-secondary-50 text-secondary-700',
  accent: 'bg-accent-50 text-accent-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
} as const;

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  tone: keyof typeof TONE_CLASSES;
  wide?: boolean;
  onClick?: () => void;
}

function StatCard({ icon, label, value, tone, wide = false, onClick }: StatCardProps) {
  const content = (
    <>
      <span className={`flex size-10 items-center justify-center rounded-xl ${TONE_CLASSES[tone]}`}>{icon}</span>
      <span className="text-sm text-neutral-600">{label}</span>
      <span className={`font-bold text-neutral-900 ${wide ? 'text-lg' : 'text-2xl'}`}>{value}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col gap-3 rounded-2xl bg-white p-5 text-start shadow-sm ring-1 ring-neutral-200 transition hover:-translate-y-0.5 hover:shadow-md"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
      {content}
    </div>
  );
}
