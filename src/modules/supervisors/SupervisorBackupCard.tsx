import { useState, type ChangeEvent } from 'react';
import { CheckCircle2, Download, FolderSync, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/StatusBlock';
import { listClasses } from '@/db/classes';
import {
  exportSupervisorBackupPackage,
  importConsolidatedInstitutionPackage,
} from '@/db/supervisorBackup';
import { useSession } from '@/modules/auth/AuthContext';
import { downloadBlob } from '@/utils/download';
import { errorKey } from '@/utils/errors';
import { parseConsolidatedPackage } from '@/utils/supervisorMerge';
import { useAsyncData } from '@/utils/useAsyncData';

export function SupervisorBackupCard() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const classesData = useAsyncData(() => listClasses(institution.id), [institution.id]);
  const classById = new Map((classesData.data ?? []).map((c) => [c.id, c.name]));

  const isHead = user.role === 'head';
  const assignedNames = isHead
    ? []
    : (user.permissions?.assignedClasses ?? [])
        .map((id) => classById.get(id))
        .filter((name): name is string => Boolean(name));

  const scopeText = isHead
    ? t('supervisorSync.scopeAll')
    : assignedNames.length > 0
      ? assignedNames.join('، ')
      : t('supervisorSync.scopeUnassigned');

  const handleExportSupervisor = async () => {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await exportSupervisorBackupPackage(institution.id, user.id, {
        allScope: t('supervisorSync.scopeAll'),
        unassignedScope: t('supervisorSync.scopeUnassigned'),
      });
      const json = JSON.stringify(result.pkg, null, 2);
      await downloadBlob(new Blob([json], { type: 'application/json' }), result.filename);
      setNotice(
        t('supervisorSync.exportedSuccess', {
          count: result.totalRecords,
          filename: result.filename,
        }),
      );
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setExporting(false);
    }
  };

  const handleImportConsolidated = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const pkg = parseConsolidatedPackage(await file.text());
      const counts = await importConsolidatedInstitutionPackage(institution.id, user.id, pkg);
      setNotice(
        t('supervisorSync.consolidatedMergedSuccess', {
          added: counts.added,
          updated: counts.updated,
          skipped: counts.skipped,
        }),
      );
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('supervisorSync.')) {
        setError(t(err.message));
      } else {
        setError(t(errorKey(err)));
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <FolderSync className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-bold text-neutral-900">{t('supervisorSync.cardTitle')}</h2>
          <p className="text-sm text-neutral-600">{t('supervisorSync.cardSubtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl bg-neutral-50 p-3.5 text-sm ring-1 ring-neutral-200/80 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-neutral-500">{t('supervisorSync.supervisorLabel')}</span>
          <span className="font-semibold text-neutral-900">{user.name}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-neutral-500">{t('supervisorSync.scopeLabel')}</span>
          <span className="font-semibold text-neutral-800">{scopeText}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Button
          fullWidth
          onClick={handleExportSupervisor}
          disabled={exporting || importing}
          icon={<Download className="size-5" aria-hidden />}
        >
          {exporting ? t('supervisorSync.exporting') : t('supervisorSync.exportButton')}
        </Button>

        <label className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 text-center text-sm font-medium text-neutral-800 ring-1 ring-inset ring-neutral-300 transition hover:bg-neutral-50 active:scale-[0.98]">
          <Upload className="size-5 shrink-0" aria-hidden />
          <span>{importing ? t('supervisorSync.importingConsolidated') : t('supervisorSync.importConsolidatedButton')}</span>
          <input
            type="file"
            accept=".edutrack,.json,application/json,text/plain,application/octet-stream"
            className="sr-only"
            disabled={exporting || importing}
            onChange={handleImportConsolidated}
          />
        </label>
      </div>

      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl bg-success-50 p-3.5 text-sm text-success-700"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="break-words">{notice}</p>
        </div>
      ) : null}

      <FormError message={error} />
    </section>
  );
}
