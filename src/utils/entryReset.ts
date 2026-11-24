import type { EntryDayClosure, EntrySession, GateEntry, StudentAbsence } from '@/db/types';
import { isPeriodInSession, resolveEntrySession } from '@/utils/entry';

export type EntryResetSessionScope = 'all' | EntrySession;

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
  session?: EntryResetSessionScope;
  eveningStartTime?: string;
}

function matchesEntrySession(
  entry: Pick<GateEntry, 'date' | 'deletedAt'> & { time?: string; session?: EntrySession },
  date: string,
  session: EntryResetSessionScope,
  eveningStartTime?: string,
): boolean {
  if (entry.deletedAt != null || entry.date !== date) return false;
  if (session === 'all') return true;
  if (entry.session) return entry.session === session;
  if (entry.time) return resolveEntrySession({ time: entry.time, session: entry.session }, eveningStartTime) === session;
  return session === 'morning';
}

function matchesAbsenceSession(
  absence: Pick<StudentAbsence, 'date' | 'deletedAt'> & { period?: number },
  date: string,
  session: EntryResetSessionScope,
  eveningStartTime?: string,
): boolean {
  if (absence.deletedAt != null || absence.date !== date) return false;
  if (session === 'all') return true;
  if (typeof absence.period !== 'number') return true;
  return isPeriodInSession(absence.period, session, eveningStartTime);
}

export function countGateEntriesBySession(
  date: string,
  entries: (Pick<GateEntry, 'date' | 'deletedAt'> & { time?: string; session?: EntrySession })[],
  eveningStartTime?: string,
): { morning: number; evening: number; total: number } {
  let morning = 0;
  let evening = 0;
  for (const item of entries) {
    if (item.deletedAt != null || item.date !== date) continue;
    const resolved =
      item.session ?? (item.time ? resolveEntrySession({ time: item.time, session: item.session }, eveningStartTime) : 'morning');
    if (resolved === 'evening') evening += 1;
    else morning += 1;
  }
  return { morning, evening, total: morning + evening };
}

export function summarizeGateDateForReset(
  date: string,
  entries: (Pick<GateEntry, 'id' | 'date' | 'result' | 'deletedAt'> & { time?: string; session?: EntrySession })[],
  absences: (Pick<StudentAbsence, 'id' | 'date' | 'source' | 'deletedAt'> & { period?: number })[],
  closure: Pick<EntryDayClosure, 'closed' | 'autoAbsencesSyncedAt' | 'createdAbsenceIds'> | null,
  session: EntryResetSessionScope = 'all',
  eveningStartTime?: string,
): GateDateResetSummary {
  const activeEntries = entries.filter((item) => matchesEntrySession(item, date, session, eveningStartTime));
  const acceptedCount = activeEntries.filter((item) => item.result === 'accepted').length;
  const rejectedCount = activeEntries.length - acceptedCount;

  const activeAbsences = absences.filter((item) => matchesAbsenceSession(item, date, session, eveningStartTime));
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
  entries: (Pick<GateEntry, 'id' | 'date' | 'deletedAt'> & { time?: string; session?: EntrySession })[],
  absences: (Pick<StudentAbsence, 'id' | 'date' | 'source' | 'deletedAt'> & { period?: number })[],
  closure: Pick<EntryDayClosure, 'closed' | 'autoAbsencesSyncedAt' | 'createdAbsenceIds'> | null,
  options?: GateDateResetOptions,
): GateDateResetPlan {
  const includeGateAbsences = options?.includeGateAbsences !== false;
  const resetClosure = options?.resetClosure !== false;
  const session = options?.session ?? 'all';
  const eveningStartTime = options?.eveningStartTime;

  const entryIdsToDelete = entries
    .filter((item) => matchesEntrySession(item, date, session, eveningStartTime))
    .map((item) => item.id);

  const gateAbsenceIdsToDelete = includeGateAbsences
    ? absences
        .filter((item) => item.source === 'gate' && matchesAbsenceSession(item, date, session, eveningStartTime))
        .map((item) => item.id)
    : [];

  const hasClosureState =
    closure != null &&
    (closure.closed || closure.autoAbsencesSyncedAt != null || closure.createdAbsenceIds.length > 0);

  return {
    entryIdsToDelete,
    gateAbsenceIdsToDelete,
    shouldResetClosure: resetClosure && hasClosureState,
  };
}

