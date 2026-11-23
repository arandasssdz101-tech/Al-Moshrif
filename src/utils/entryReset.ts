import type { EntryDayClosure, GateEntry, StudentAbsence } from '@/db/types';

export interface GateDateResetSummary {
  date: string;
  entriesCount: number;
  acceptedCount: number;
  rejectedCount: number;
  gateAbsencesCount: number;
  manualAbsencesCount: number;
  isClosed: boolean;
  isSynced: boolean;
  hasAnythingToReset: boolean;
}

export interface GateDateResetPlan {
  entryIdsToDelete: string[];
  gateAbsenceIdsToDelete: string[];
  shouldResetClosure: boolean;
}

export interface GateDateResetOptions {
  includeGateAbsences?: boolean;
  resetClosure?: boolean;
}

export function summarizeGateDateForReset(
  date: string,
  entries: Pick<GateEntry, 'id' | 'date' | 'result' | 'deletedAt'>[],
  absences: Pick<StudentAbsence, 'id' | 'date' | 'source' | 'deletedAt'>[],
  closure: Pick<EntryDayClosure, 'closed' | 'autoAbsencesSyncedAt' | 'createdAbsenceIds'> | null,
): GateDateResetSummary {
  const activeEntries = entries.filter((item) => item.deletedAt === null && item.date === date);
  const acceptedCount = activeEntries.filter((item) => item.result === 'accepted').length;
  const rejectedCount = activeEntries.length - acceptedCount;

  const activeAbsences = absences.filter((item) => item.deletedAt === null && item.date === date);
  const gateAbsencesCount = activeAbsences.filter((item) => item.source === 'gate').length;
  const manualAbsencesCount = activeAbsences.length - gateAbsencesCount;

  const isClosed = Boolean(closure?.closed);
  const isSynced = Boolean(closure?.autoAbsencesSyncedAt);
  const hasClosureState = isClosed || isSynced || (closure?.createdAbsenceIds.length ?? 0) > 0;

  return {
    date,
    entriesCount: activeEntries.length,
    acceptedCount,
    rejectedCount,
    gateAbsencesCount,
    manualAbsencesCount,
    isClosed,
    isSynced,
    hasAnythingToReset: activeEntries.length > 0 || gateAbsencesCount > 0 || hasClosureState,
  };
}

export function planGateDateReset(
  date: string,
  entries: Pick<GateEntry, 'id' | 'date' | 'deletedAt'>[],
  absences: Pick<StudentAbsence, 'id' | 'date' | 'source' | 'deletedAt'>[],
  closure: Pick<EntryDayClosure, 'closed' | 'autoAbsencesSyncedAt' | 'createdAbsenceIds'> | null,
  options?: GateDateResetOptions,
): GateDateResetPlan {
  const includeGateAbsences = options?.includeGateAbsences !== false;
  const resetClosure = options?.resetClosure !== false;

  const entryIdsToDelete = entries
    .filter((item) => item.deletedAt === null && item.date === date)
    .map((item) => item.id);

  const gateAbsenceIdsToDelete = includeGateAbsences
    ? absences
        .filter((item) => item.deletedAt === null && item.date === date && item.source === 'gate')
        .map((item) => item.id)
    : [];

  const hasClosureState =
    closure !== null &&
    (closure.closed || closure.autoAbsencesSyncedAt !== null || closure.createdAbsenceIds.length > 0);

  return {
    entryIdsToDelete,
    gateAbsenceIdsToDelete,
    shouldResetClosure: resetClosure && hasClosureState,
  };
}
