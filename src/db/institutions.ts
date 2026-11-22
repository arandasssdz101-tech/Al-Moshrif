import { DomainError } from '@/utils/errors';
import { db } from './database';
import { touchFields } from './records';
import { assertHeadActor } from './users';
import type { AbsenceCountRule, AbsenceThresholdType, CanteenMatchField, Holiday, Institution } from './types';
import { generateInviteCode } from '@/utils/invite';

export const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];

export async function getInstitution(institutionId: string): Promise<Institution> {
  const institution = await db.institutions.get(institutionId);
  if (!institution || institution.deletedAt !== null) {
    throw new DomainError('errors.notFound');
  }
  return institution;
}

export interface InstitutionSettingsInput {
  name: string;
  rooms: number;
  workingDays: number[];
  canteenDays: number[];
  holidays: Holiday[];
  directorate: string;
  city: string;
  reportNumberPrefix: string;
  absenceCountRule: AbsenceCountRule;
  absenceThresholdType: AbsenceThresholdType;
  absenceThresholdValue: number;
  canteenMatchField: CanteenMatchField;
  canteenTrackingStart: string | null;
  cardAbsenceEnabled?: boolean;
  librarySupervisorsCanManage?: boolean;
  entryStartTime?: string;
  entryLateAfterMinutes?: number;
  entryUseFirstTimetableLesson?: boolean;
  entrySoundEnabled?: boolean;
  entryVibrationEnabled?: boolean;
  entryCooldownSeconds?: number;
  entryMarkLateMissedLessons?: boolean;
}

export function isCardAbsenceEnabled(institution: Pick<Institution, 'cardAbsenceEnabled'>): boolean {
  return institution.cardAbsenceEnabled !== false;
}

export function canSupervisorsManageLibrary(
  institution: Pick<Institution, 'librarySupervisorsCanManage'>,
): boolean {
  return institution.librarySupervisorsCanManage === true;
}

export async function updateInstitutionSettings(
  institutionId: string,
  input: InstitutionSettingsInput,
  actorId: string,
): Promise<void> {
  await assertHeadActor(actorId);
  const institution = await getInstitution(institutionId);
  await db.institutions.put({
    ...institution,
    name: input.name.trim(),
    rooms: input.rooms,
    workingDays: [...input.workingDays].sort((a, b) => a - b),
    canteenDays: [...input.canteenDays].sort((a, b) => a - b),
    holidays: [...input.holidays].sort((a, b) => a.date.localeCompare(b.date)),
    directorate: input.directorate.trim(),
    city: input.city.trim(),
    reportNumberPrefix: input.reportNumberPrefix.trim(),
    absenceCountRule: input.absenceCountRule,
    canteenMatchField: input.canteenMatchField,
    canteenTrackingStart: input.canteenTrackingStart || null,
    absenceThresholdType: input.absenceThresholdType,
    absenceThresholdValue: input.absenceThresholdValue,
    cardAbsenceEnabled: input.cardAbsenceEnabled ?? institution.cardAbsenceEnabled ?? true,
    librarySupervisorsCanManage:
      input.librarySupervisorsCanManage ?? institution.librarySupervisorsCanManage ?? false,
    entryStartTime: input.entryStartTime ?? institution.entryStartTime ?? '08:00',
    entryLateAfterMinutes: input.entryLateAfterMinutes ?? institution.entryLateAfterMinutes ?? 10,
    entryUseFirstTimetableLesson:
      input.entryUseFirstTimetableLesson ?? institution.entryUseFirstTimetableLesson ?? false,
    entrySoundEnabled: input.entrySoundEnabled ?? institution.entrySoundEnabled ?? true,
    entryVibrationEnabled: input.entryVibrationEnabled ?? institution.entryVibrationEnabled ?? true,
    entryCooldownSeconds: input.entryCooldownSeconds ?? institution.entryCooldownSeconds ?? 3,
    entryMarkLateMissedLessons:
      input.entryMarkLateMissedLessons ?? institution.entryMarkLateMissedLessons ?? false,
    ...touchFields(actorId),
  });
}

export async function updateCardAbsenceEnabled(
  institutionId: string,
  enabled: boolean,
  actorId: string,
): Promise<void> {
  await assertHeadActor(actorId);
  const institution = await getInstitution(institutionId);
  await db.institutions.put({
    ...institution,
    cardAbsenceEnabled: enabled,
    ...touchFields(actorId),
  });
}

export async function updateCanteenTrackingStart(
  institutionId: string,
  trackingStart: string | null,
  actorId: string,
): Promise<void> {
  await assertHeadActor(actorId);
  const institution = await getInstitution(institutionId);
  await db.institutions.put({
    ...institution,
    canteenTrackingStart: trackingStart || null,
    ...touchFields(actorId),
  });
}

export async function renewInviteCode(institutionId: string, actorId: string): Promise<string> {
  await assertHeadActor(actorId);
  const institution = await getInstitution(institutionId);
  const inviteCode = generateInviteCode();
  await db.institutions.put({ ...institution, inviteCode, ...touchFields(actorId) });
  return inviteCode;
}
