import { describe, expect, it, vi } from 'vitest';
import { emitAppDataChanged, subscribeAppDataChanged } from './dataEvents';
import {
  countGateEntriesBySession,
  planGateDateReset,
  summarizeGateDateForReset,
} from './entryReset';

describe('entryReset helpers', () => {
  const DATE = '2026-11-23';
  const OTHER_DATE = '2026-11-22';

  const entries = [
    { id: 'e1', date: DATE, result: 'accepted' as const, deletedAt: null },
    { id: 'e2', date: DATE, result: 'duplicate' as const, deletedAt: null },
    { id: 'e3', date: DATE, result: 'accepted' as const, deletedAt: '2026-11-23T08:05:00.000Z' },
    { id: 'e4', date: OTHER_DATE, result: 'accepted' as const, deletedAt: null },
  ];

  const absences = [
    { id: 'a1', date: DATE, source: 'gate' as const, deletedAt: null },
    { id: 'a2', date: DATE, source: 'manual' as const, deletedAt: null },
    { id: 'a3', date: DATE, source: 'continuous' as const, deletedAt: null },
    { id: 'a4', date: OTHER_DATE, source: 'gate' as const, deletedAt: null },
  ];

  const closure = {
    closed: true,
    autoAbsencesSyncedAt: '2026-11-23T08:10:00.000Z',
    createdAbsenceIds: ['a1'],
  };

  it('summarizes active entries, gate vs manual absences, and closure status for the chosen date only', () => {
    const summary = summarizeGateDateForReset(DATE, entries, absences, closure);
    expect(summary).toEqual({
      date: DATE,
      entriesCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      gateAbsencesCount: 1,
      manualAbsencesCount: 2,
      isClosed: true,
      isSynced: true,
      hasAnythingToReset: true,
    });
  });

  it('plans full date reset while preserving manual absences and other dates', () => {
    const plan = planGateDateReset(DATE, entries, absences, closure);
    expect(plan.entryIdsToDelete).toEqual(['e1', 'e2']);
    expect(plan.gateAbsenceIdsToDelete).toEqual(['a1']);
    expect(plan.shouldResetClosure).toBe(true);
  });

  it('respects includeGateAbsences=false and resetClosure=false when user only wants to clear gate scans', () => {
    const plan = planGateDateReset(DATE, entries, absences, closure, {
      includeGateAbsences: false,
      resetClosure: false,
    });
    expect(plan.entryIdsToDelete).toEqual(['e1', 'e2']);
    expect(plan.gateAbsenceIdsToDelete).toEqual([]);
    expect(plan.shouldResetClosure).toBe(false);
  });

  it('reports hasAnythingToReset=false when date has no entries, gate absences, or closure state', () => {
    const summary = summarizeGateDateForReset('2026-11-20', entries, absences, null);
    expect(summary.hasAnythingToReset).toBe(false);
  });

  it('scopes reset summary and plan by morning vs evening session', () => {
    const twoShiftEntries = [
      { id: 'm1', date: DATE, time: '07:55:00', session: 'morning' as const, result: 'accepted' as const, deletedAt: null },
      { id: 'e1', date: DATE, time: '13:02:00', session: 'evening' as const, result: 'accepted' as const, deletedAt: null },
      { id: 'e2', date: DATE, time: '13:10:00', session: 'evening' as const, result: 'duplicate' as const, deletedAt: null },
    ];
    const twoShiftAbsences = [
      { id: 'am', date: DATE, period: 1, source: 'gate' as const, deletedAt: null },
      { id: 'ae', date: DATE, period: 5, source: 'gate' as const, deletedAt: null },
    ];

    expect(countGateEntriesBySession(DATE, twoShiftEntries)).toEqual({
      morning: 1,
      evening: 2,
      total: 3,
    });

    const eveningSummary = summarizeGateDateForReset(DATE, twoShiftEntries, twoShiftAbsences, closure, 'evening');
    expect(eveningSummary.entriesCount).toBe(2);
    expect(eveningSummary.acceptedCount).toBe(1);
    expect(eveningSummary.gateAbsencesCount).toBe(1);

    const eveningPlan = planGateDateReset(DATE, twoShiftEntries, twoShiftAbsences, closure, { session: 'evening' });
    expect(eveningPlan.entryIdsToDelete).toEqual(['e1', 'e2']);
    expect(eveningPlan.gateAbsenceIdsToDelete).toEqual(['ae']);
    expect(eveningPlan.shouldResetClosure).toBe(true);
  });
});

describe('dataEvents bus', () => {
  it('notifies only subscribers matching emitted domains and cleans up on unsubscribe', () => {
    const onAbsences = vi.fn();
    const onTimetable = vi.fn();
    const unsub1 = subscribeAppDataChanged(['absences', 'sync'], onAbsences);
    const unsub2 = subscribeAppDataChanged(['timetable'], onTimetable);

    emitAppDataChanged(['entries', 'sync'], { date: '2026-11-23', reason: 'test' });
    expect(onAbsences).toHaveBeenCalledTimes(1);
    expect(onAbsences.mock.calls[0][0].date).toBe('2026-11-23');
    expect(onTimetable).not.toHaveBeenCalled();

    unsub1();
    emitAppDataChanged(['absences']);
    expect(onAbsences).toHaveBeenCalledTimes(1);

    unsub2();
  });
});
