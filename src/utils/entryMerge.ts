import { ENTRY_RESULTS, ENTRY_SESSIONS, ENTRY_SOURCES, type GateEntry } from '@/db/types';
import { resolveEntrySession } from '@/utils/entry';

export const ENTRY_EXPORT_FORMAT = 'school-admin-gate-entries';
export const ENTRY_EXPORT_VERSION = 1;

export interface EntryExportFile {
  format: typeof ENTRY_EXPORT_FORMAT;
  version: typeof ENTRY_EXPORT_VERSION;
  exportedAt: string;
  institutionId: string;
  entries: GateEntry[];
}

export function buildEntryExport(institutionId: string, entries: GateEntry[]): string {
  const payload: EntryExportFile = {
    format: ENTRY_EXPORT_FORMAT,
    version: ENTRY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    institutionId,
    entries,
  };
  return JSON.stringify(payload, null, 2);
}

function isGateEntry(value: unknown): value is GateEntry {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<GateEntry>;
  return (
    typeof item.id === 'string' &&
    typeof item.institutionId === 'string' &&
    (item.studentId === null || typeof item.studentId === 'string') &&
    typeof item.scannedCode === 'string' &&
    typeof item.date === 'string' &&
    typeof item.time === 'string' &&
    typeof item.result === 'string' &&
    (ENTRY_RESULTS as readonly string[]).includes(item.result) &&
    typeof item.late === 'boolean' &&
    typeof item.minutesLate === 'number' &&
    typeof item.source === 'string' &&
    (ENTRY_SOURCES as readonly string[]).includes(item.source) &&
    (item.session === undefined ||
      (typeof item.session === 'string' && (ENTRY_SESSIONS as readonly string[]).includes(item.session))) &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string' &&
    (item.deletedAt === null || typeof item.deletedAt === 'string')
  );
}

export function parseEntryExport(text: string): GateEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const file = parsed as Partial<EntryExportFile>;
  if (file.format !== ENTRY_EXPORT_FORMAT || file.version !== ENTRY_EXPORT_VERSION) {
    return null;
  }
  if (!Array.isArray(file.entries) || !file.entries.every(isGateEntry)) {
    return null;
  }
  return file.entries;
}

export interface EntryMergePlan {
  toPut: GateEntry[];
  addedCount: number;
  downgradedToDuplicateCount: number;
  skippedCount: number;
}

function compareEntryChrono(a: GateEntry, b: GateEntry): number {
  return (
    a.time.localeCompare(b.time) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function planEntryMerge(
  existing: GateEntry[],
  incoming: GateEntry[],
  targetInstitutionId: string,
): EntryMergePlan {
  const byId = new Map<string, GateEntry>();
  for (const item of existing) {
    byId.set(item.id, { ...item });
  }

  let addedCount = 0;
  let skippedCount = 0;
  const touchedIds = new Set<string>();

  for (const raw of incoming) {
    const normalized: GateEntry = {
      ...raw,
      institutionId: targetInstitutionId,
      deviceId: raw.deviceId || 'imported',
    };
    const prev = byId.get(normalized.id);
    if (!prev) {
      byId.set(normalized.id, normalized);
      touchedIds.add(normalized.id);
      addedCount += 1;
    } else if (normalized.updatedAt > prev.updatedAt) {
      byId.set(normalized.id, normalized);
      touchedIds.add(normalized.id);
    } else {
      skippedCount += 1;
    }
  }

  // Group all active accepted entries by studentId + date + session; keep the earliest, downgrade later ones to duplicate.
  const acceptedByStudentDay = new Map<string, GateEntry[]>();
  for (const entry of byId.values()) {
    if (entry.deletedAt !== null || entry.result !== 'accepted' || !entry.studentId) continue;
    const session = resolveEntrySession(entry);
    const key = `${entry.date}|${session}|${entry.studentId}`;
    const list = acceptedByStudentDay.get(key) ?? [];
    list.push(entry);
    acceptedByStudentDay.set(key, list);
  }

  let downgradedToDuplicateCount = 0;
  const nowIso = new Date().toISOString();

  for (const group of acceptedByStudentDay.values()) {
    if (group.length <= 1) continue;
    group.sort(compareEntryChrono);
    // Keep index 0 as accepted; mark indices 1..n-1 as duplicate
    for (let i = 1; i < group.length; i += 1) {
      const later = group[i];
      const updated: GateEntry = {
        ...later,
        result: 'duplicate',
        late: false,
        minutesLate: 0,
        updatedAt: nowIso,
      };
      byId.set(updated.id, updated);
      touchedIds.add(updated.id);
      downgradedToDuplicateCount += 1;
    }
  }

  const toPut = Array.from(touchedIds)
    .map((id) => byId.get(id))
    .filter((item): item is GateEntry => item !== undefined);

  return {
    toPut,
    addedCount,
    downgradedToDuplicateCount,
    skippedCount,
  };
}
