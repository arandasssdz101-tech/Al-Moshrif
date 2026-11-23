import { useCallback, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  hasExistingLocalData,
  isValidAuthBackup,
  parseBackup,
  replaceAllData,
  summarizeBackup,
  type BackupData,
  type BackupSummary,
} from '@/db/backup';
import { errorKey } from '@/utils/errors';
import { clearSessionUserId } from '@/utils/session';

export interface AuthBackupRestoreState {
  error: string | null;
  pendingRestore: BackupData | null;
  summary: BackupSummary | null;
  willOverwrite: boolean;
  restoring: boolean;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleConfirmRestore: () => Promise<void>;
  cancelRestore: () => void;
  clearError: () => void;
}

export function useAuthBackupRestore(onRestored: () => void): AuthBackupRestoreState {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupData | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [willOverwrite, setWillOverwrite] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      setError(null);
      try {
        const parsed = parseBackup(await file.text());
        if (!parsed) {
          setError(t('institution.restoreInvalid'));
          return;
        }
        if (!isValidAuthBackup(parsed)) {
          setError(t('auth.backup.noAccounts'));
          return;
        }
        const existingData = await hasExistingLocalData();
        setSummary(summarizeBackup(parsed));
        setWillOverwrite(existingData);
        setPendingRestore(parsed);
      } catch (readError) {
        setError(t(errorKey(readError)));
      }
    },
    [t],
  );

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingRestore) return;
    setRestoring(true);
    setError(null);
    try {
      await replaceAllData(pendingRestore);
      // Never auto-authenticate from an imported file; require normal credential sign-in
      clearSessionUserId();
      setPendingRestore(null);
      setSummary(null);
      setWillOverwrite(false);
      onRestored();
    } catch (restoreError) {
      setPendingRestore(null);
      setSummary(null);
      setError(t(errorKey(restoreError)));
    } finally {
      setRestoring(false);
    }
  }, [onRestored, pendingRestore, t]);

  const cancelRestore = useCallback(() => {
    if (restoring) return;
    setPendingRestore(null);
    setSummary(null);
    setWillOverwrite(false);
  }, [restoring]);

  const clearError = useCallback(() => setError(null), []);

  return {
    error,
    pendingRestore,
    summary,
    willOverwrite,
    restoring,
    handleFileChange,
    handleConfirmRestore,
    cancelRestore,
    clearError,
  };
}
