import { useState } from 'react';
import { CheckCircle2, FileSpreadsheet, GitMerge, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AddSupervisorModal } from './AddSupervisorModal';
import { BatchMergeCenterScreen } from './BatchMergeCenterScreen';
import { SupervisorPermissionsScreen } from './SupervisorPermissionsScreen';
import { SupervisorRow } from './SupervisorRow';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/StatusBlock';
import { listClasses } from '@/db/classes';
import { listSupervisors, removeSupervisor, setSupervisorStatus } from '@/db/users';
import type { User, UserStatus } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { errorKey } from '@/utils/errors';
import { exportRowsToExcel } from '@/utils/spreadsheet';
import { useAsyncData } from '@/utils/useAsyncData';

const STATUS_ORDER: UserStatus[] = ['pending', 'approved', 'rejected'];

export function SupervisorsScreen() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mergeCenterOpen, setMergeCenterOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const supervisors = useAsyncData(
    () => Promise.all([listSupervisors(institution.id), listClasses(institution.id)]),
    [institution.id],
  );
  const data = supervisors.data?.[0];
  const classNameById = new Map((supervisors.data?.[1] ?? []).map((item) => [item.id, item.name]));
  const namesFor = (item: User) =>
    (item.permissions?.assignedClasses ?? [])
      .map((id) => classNameById.get(id))
      .filter((name): name is string => Boolean(name));

  if (mergeCenterOpen) {
    return (
      <BatchMergeCenterScreen
        onBack={() => {
          setMergeCenterOpen(false);
          supervisors.reload();
        }}
      />
    );
  }

  if (selectedId) {
    return (
      <SupervisorPermissionsScreen
        userId={selectedId}
        onBack={() => {
          setSelectedId(null);
          supervisors.reload();
        }}
      />
    );
  }

  const handleSetStatus = async (userId: string, status: UserStatus) => {
    setBusyId(userId);
    setActionError(null);
    setNotice(null);
    try {
      await setSupervisorStatus(userId, status, user.id);
      supervisors.reload();
    } catch (error) {
      setActionError(t(errorKey(error)));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setBusyId(deleteTarget.id);
    setActionError(null);
    setNotice(null);
    try {
      await removeSupervisor(deleteTarget.id, user.id);
      setDeleteTarget(null);
      setNotice(t('supervisors.deletedSuccess'));
      supervisors.reload();
    } catch (error) {
      setDeleteTarget(null);
      setActionError(t(errorKey(error)));
    } finally {
      setDeleting(false);
      setBusyId(null);
    }
  };

  const handleExport = () => {
    const rows = (data ?? []).map((supervisor) => ({
      [t('supervisors.columns.name')]: supervisor.name,
      [t('supervisors.columns.username')]: supervisor.usernameKey,
      [t('supervisors.columns.status')]: t(`supervisors.status.${supervisor.status}`),
      [t('supervisors.columns.classes')]: namesFor(supervisor).join(', '),
      [t('supervisors.columns.scope')]:
        supervisor.permissions?.searchScope === 'institution'
          ? t('supervisors.scopeInstitution')
          : t('supervisors.scopeAssigned'),
    }));
    exportRowsToExcel(rows, t('supervisors.title'), `supervisors-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const groups = STATUS_ORDER.map((status) => ({
    status,
    items: (data ?? []).filter((item) => item.status === status),
  }));
  const sectionTitles: Record<UserStatus, string> = {
    pending: t('supervisors.pendingSection'),
    approved: t('supervisors.approvedSection'),
    rejected: t('supervisors.rejectedSection'),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl text-neutral-900">{t('supervisors.title')}</h1>
          <p className="text-base text-neutral-600">{t('supervisors.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setActionError(null);
              setNotice(null);
              setAddOpen(true);
            }}
            icon={<UserPlus className="size-5" aria-hidden />}
          >
            {t('supervisors.addSupervisor')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMergeCenterOpen(true)}
            icon={<GitMerge className="size-5" aria-hidden />}
          >
            {t('supervisorSync.openMergeCenter')}
          </Button>
          {data && data.length > 0 ? (
            <Button variant="secondary" onClick={handleExport} icon={<FileSpreadsheet className="size-5" aria-hidden />}>
              {t('supervisors.exportExcel')}
            </Button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl bg-success-50 p-4 text-base text-success-700 animate-fade-in"
        >
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          <p>{notice}</p>
        </div>
      ) : null}

      <FormError message={actionError} />

      {supervisors.loading && !data ? (
        <LoadingState />
      ) : supervisors.error ? (
        <ErrorState message={t(errorKey(supervisors.error))} onRetry={supervisors.reload} />
      ) : data && data.length === 0 ? (
        <EmptyState icon={<Users className="size-7" aria-hidden />} title={t('supervisors.emptyTitle')} body={t('supervisors.emptyBody')} />
      ) : (
        groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <section key={group.status} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{sectionTitles[group.status]}</h2>
              <ul className="flex flex-col gap-3">
                {group.items.map((supervisor: User) => (
                  <SupervisorRow
                    key={supervisor.id}
                    supervisor={supervisor}
                    assignedClassNames={namesFor(supervisor)}
                    busy={busyId === supervisor.id}
                    onOpen={setSelectedId}
                    onSetStatus={handleSetStatus}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </ul>
            </section>
          ))
      )}

      <AddSupervisorModal
        open={addOpen}
        institutionId={institution.id}
        actorId={user.id}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setNotice(t('supervisors.addedSuccess'));
          supervisors.reload();
        }}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title={t('supervisors.removeTitle')}
        body={
          deleteTarget
            ? `${deleteTarget.name} (@${deleteTarget.usernameKey}) — ${t('supervisors.removeBody')}`
            : t('supervisors.removeBody')
        }
        confirmLabel={t('supervisors.removeSupervisor')}
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
