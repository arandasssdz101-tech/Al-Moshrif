import { emitAppDataChanged } from '@/utils/dataEvents';
import { DomainError } from '@/utils/errors';
import { db } from './database';
import { listClasses } from './classes';
import { assertCanEditClassIn, canAccessClass, getStudentAccess, type StudentAccess } from './access';
import { newBaseFields, touchFields } from './records';
import { prepareStudentInput, studentIdentityKey, validateStudentInput } from './studentRules';
import type { SchoolClass, Student, StudentInput } from './types';
import { planStudentImport, type StudentImportMode } from '@/modules/students/import/importRows';

export interface StudentWorkspace {
  access: StudentAccess;
  classes: SchoolClass[];
  students: Student[];
}

export async function loadStudentWorkspace(institutionId: string, actorId: string): Promise<StudentWorkspace> {
  const access = await getStudentAccess(actorId);
  const [allClasses, allStudents] = await Promise.all([listClasses(institutionId), listActiveStudents(institutionId)]);
  return {
    access,
    classes: allClasses.filter((schoolClass) => canAccessClass(access, schoolClass.id)),
    students: allStudents.filter((student) => canAccessClass(access, student.classId)),
  };
}

async function listActiveStudents(institutionId: string): Promise<Student[]> {
  const students = await db.students.where('institutionId').equals(institutionId).toArray();
  return students
    .filter((student) => student.deletedAt == null)
    .sort(
      (a, b) =>
        (a.lastName ?? '').localeCompare(b.lastName ?? '') ||
        (a.firstName ?? '').localeCompare(b.firstName ?? ''),
    );
}

async function getActiveStudent(studentId: string): Promise<Student> {
  const student = await db.students.get(studentId);
  if (!student || student.deletedAt != null) {
    throw new DomainError('errors.notFound');
  }
  return student;
}

function assertValidInput(input: StudentInput): void {
  const [issue] = validateStudentInput(input);
  if (issue) throw new DomainError(issue.key);
}

async function assertClassIsActive(classId: string): Promise<void> {
  const schoolClass = await db.classes.get(classId);
  if (!schoolClass || schoolClass.deletedAt != null) {
    throw new DomainError('validation.classNotFound');
  }
}

async function assertNoDuplicate(institutionId: string, input: StudentInput, exceptId: string | null): Promise<void> {
  const key = studentIdentityKey(input);
  const students = await listActiveStudents(institutionId);
  if (students.some((student) => student.id !== exceptId && studentIdentityKey(student) === key)) {
    throw new DomainError('validation.duplicateStudent');
  }
}

async function assertNoDuplicateCardCode(institutionId: string, cardCode: string | null | undefined, exceptId: string | null): Promise<void> {
  if (!cardCode) return;
  const students = await listActiveStudents(institutionId);
  if (students.some((student) => student.id !== exceptId && student.cardCode === cardCode)) {
    throw new DomainError('students.cardCode.duplicate');
  }
}

export async function createStudent(institutionId: string, rawInput: StudentInput, actorId: string): Promise<Student> {
  const input = prepareStudentInput(rawInput);
  assertCanEditClassIn(await getStudentAccess(actorId), input.classId);
  assertValidInput(input);
  await assertClassIsActive(input.classId);
  await assertNoDuplicate(institutionId, input, null);
  await assertNoDuplicateCardCode(institutionId, input.cardCode, null);
  const record: Student = { ...newBaseFields(institutionId, actorId), ...input };
  await db.students.add(record);
  emitAppDataChanged(['students'], { reason: 'create-student' });
  return record;
}

export async function updateStudent(studentId: string, rawInput: StudentInput, actorId: string): Promise<void> {
  const input = prepareStudentInput(rawInput);
  const student = await getActiveStudent(studentId);
  const access = await getStudentAccess(actorId);
  assertCanEditClassIn(access, student.classId);
  assertCanEditClassIn(access, input.classId);
  assertValidInput(input);
  await assertClassIsActive(input.classId);
  await assertNoDuplicate(student.institutionId, input, studentId);
  await assertNoDuplicateCardCode(student.institutionId, input.cardCode, studentId);
  await db.students.put({ ...student, ...input, ...touchFields(actorId) });
  emitAppDataChanged(['students'], { reason: 'update-student' });
}

export async function deleteStudent(studentId: string, actorId: string): Promise<void> {
  const student = await getActiveStudent(studentId);
  assertCanEditClassIn(await getStudentAccess(actorId), student.classId);
  await db.students.put({ ...student, deletedAt: new Date().toISOString(), ...touchFields(actorId) });
  emitAppDataChanged(['students'], { reason: 'delete-student' });
}

export async function restoreStudent(studentId: string, actorId: string): Promise<void> {
  const student = await db.students.get(studentId);
  if (!student) throw new DomainError('errors.notFound');
  assertCanEditClassIn(await getStudentAccess(actorId), student.classId);
  await assertClassIsActive(student.classId);
  await assertNoDuplicate(student.institutionId, student, studentId);
  await db.students.put({ ...student, deletedAt: null, ...touchFields(actorId) });
  emitAppDataChanged(['students'], { reason: 'restore-student' });
}

export async function importStudents(institutionId: string, rows: StudentInput[], actorId: string): Promise<number> {
  const access = await getStudentAccess(actorId);
  const existingKeys = new Set((await listActiveStudents(institutionId)).map(studentIdentityKey));
  const existingCardCodes = new Set((await listActiveStudents(institutionId)).map((student) => student.cardCode).filter(Boolean));
  const records: Student[] = [];

  for (const rawRow of rows) {
    const row = prepareStudentInput(rawRow);
    assertCanEditClassIn(access, row.classId);
    assertValidInput(row);
    await assertClassIsActive(row.classId);
    const key = studentIdentityKey(row);
    if (existingKeys.has(key)) throw new DomainError('validation.duplicateStudent');
    if (row.cardCode && existingCardCodes.has(row.cardCode)) throw new DomainError('students.cardCode.duplicate');
    existingKeys.add(key);
    if (row.cardCode) existingCardCodes.add(row.cardCode);
    records.push({ ...newBaseFields(institutionId, actorId), ...row });
  }

  if (records.length > 0) {
    await db.students.bulkAdd(records);
    emitAppDataChanged(['students'], { reason: 'import-students' });
  }
  return records.length;
}

export interface ImportStudentsWithModeOptions {
  mode: StudentImportMode;
  deleteExtraStudentIds?: string[];
}

export interface ImportStudentsResult {
  added: number;
  updated: number;
  skippedExisting: number;
  deleted: number;
}

export async function importStudentsWithMode(
  institutionId: string,
  rows: StudentInput[],
  actorId: string,
  options: ImportStudentsWithModeOptions,
): Promise<ImportStudentsResult> {
  const access = await getStudentAccess(actorId);
  const allActive = await listActiveStudents(institutionId);
  const editableActive = allActive.filter((student) => canAccessClass(access, student.classId));

  const preparedRows: StudentInput[] = [];
  for (const rawRow of rows) {
    const row = prepareStudentInput(rawRow);
    assertCanEditClassIn(access, row.classId);
    assertValidInput(row);
    await assertClassIsActive(row.classId);
    preparedRows.push(row);
  }

  const plan = planStudentImport({
    existing: editableActive,
    incomingRows: preparedRows,
    mode: options.mode,
    deleteExtraStudentIds: options.deleteExtraStudentIds,
  });

  // Verify access on any students marked for deletion
  for (const student of plan.toDelete) {
    assertCanEditClassIn(access, student.classId);
  }

  // Ensure cardCode uniqueness across the final active institution set
  const deletedIds = new Set(plan.toDelete.map((item) => item.id));
  const updatedById = new Map(plan.toUpdate.map((item) => [item.existing.id, item.input]));
  const finalCardCodes = new Set<string>();

  for (const student of allActive) {
    if (deletedIds.has(student.id)) continue;
    const override = updatedById.get(student.id);
    const code = (override ? override.cardCode?.trim() || student.cardCode : student.cardCode)?.trim();
    if (code) {
      if (finalCardCodes.has(code)) throw new DomainError('students.cardCode.duplicate');
      finalCardCodes.add(code);
    }
  }
  for (const row of plan.toAdd) {
    const code = row.cardCode?.trim();
    if (code) {
      if (finalCardCodes.has(code)) throw new DomainError('students.cardCode.duplicate');
      finalCardCodes.add(code);
    }
  }

  const now = new Date().toISOString();
  const toPut: Student[] = [
    ...plan.toUpdate.map(({ existing, input }) => ({
      ...existing,
      ...input,
      // Never wipe an existing student's cardCode if the re-imported file omits it
      cardCode: input.cardCode?.trim() || existing.cardCode?.trim() || null,
      ...touchFields(actorId),
    })),
    ...plan.toDelete.map((student) => ({
      ...student,
      deletedAt: now,
      ...touchFields(actorId),
    })),
  ];

  const toAddRecords: Student[] = plan.toAdd.map((row) => ({
    ...newBaseFields(institutionId, actorId),
    ...row,
  }));

  await db.transaction('rw', db.students, async () => {
    if (toPut.length > 0) await db.students.bulkPut(toPut);
    if (toAddRecords.length > 0) await db.students.bulkAdd(toAddRecords);
  });
  emitAppDataChanged(['students'], { reason: 'import-students-mode' });

  return {
    added: toAddRecords.length,
    updated: plan.toUpdate.length,
    skippedExisting: plan.skippedExistingCount,
    deleted: plan.toDelete.length,
  };
}

export async function setStudentCardCode(studentId: string, cardCode: string, actorId: string): Promise<void> {
  const student = await getActiveStudent(studentId);
  assertCanEditClassIn(await getStudentAccess(actorId), student.classId);
  const code = cardCode.trim();
  await assertNoDuplicateCardCode(student.institutionId, code, studentId);
  await db.students.put({ ...student, cardCode: code, ...touchFields(actorId) });
  emitAppDataChanged(['students'], { reason: 'student-card-code' });
}

export async function updateStudentBoarding(studentId: string, boardingStatus: 'half-boarder' | 'external', actorId: string): Promise<void> {
  const student = await getActiveStudent(studentId);
  assertCanEditClassIn(await getStudentAccess(actorId), student.classId);
  await db.students.put({ ...student, boardingStatus, ...touchFields(actorId) });
  emitAppDataChanged(['students'], { reason: 'student-boarding' });
}

export interface HbUpsertRow {
  action: 'new' | 'update';
  input: StudentInput | null;
  matchedStudentId: string | null;
  cardCode: string;
}

export interface HbUpsertResult {
  created: number;
  updated: number;
  convertedToExternal: number;
}

export async function upsertHalfBoarders(
  institutionId: string,
  rows: HbUpsertRow[],
  actorId: string,
  convertToExternalIds: string[] = [],
): Promise<HbUpsertResult> {
  const access = await getStudentAccess(actorId);
  const activeStudents = await listActiveStudents(institutionId);
  const existingCardCodes = new Set(activeStudents.map((s) => s.cardCode?.trim()).filter(Boolean));
  const studentById = new Map(activeStudents.map((s) => [s.id, s]));
  let created = 0;
  let updated = 0;
  let convertedToExternal = 0;

  for (const row of rows) {
    try {
      if (row.action === 'new' && row.input) {
        const input = prepareStudentInput(row.input);
        if (!input.classId) continue;
        assertCanEditClassIn(access, input.classId);
        assertValidInput(input);
        await assertClassIsActive(input.classId);
        const code = input.cardCode?.trim() || null;
        if (code && existingCardCodes.has(code)) continue;
        if (code) existingCardCodes.add(code);
        const record: Student = { ...newBaseFields(institutionId, actorId), ...input, cardCode: code };
        await db.students.add(record);
        created++;
      } else if (row.action === 'update' && row.matchedStudentId) {
        const student = studentById.get(row.matchedStudentId);
        if (!student) continue;
        assertCanEditClassIn(access, student.classId);
        const code = row.cardCode.trim() || null;
        if (code && code !== student.cardCode?.trim()) {
          if (existingCardCodes.has(code)) continue;
          existingCardCodes.add(code);
        }
        const updatedClassId = row.input?.classId || student.classId;
        if (updatedClassId !== student.classId) {
          assertCanEditClassIn(access, updatedClassId);
          await assertClassIsActive(updatedClassId);
        }
        await db.students.put({
          ...student,
          ...(row.input
            ? {
                firstName: row.input.firstName,
                lastName: row.input.lastName,
                dateOfBirth: row.input.dateOfBirth,
                classId: updatedClassId,
              }
            : {}),
          boardingStatus: row.input?.boardingStatus ?? 'half-boarder',
          cardCode: code ?? student.cardCode,
          ...touchFields(actorId),
        });
        updated++;
      }
    } catch {
      continue;
    }
  }

  for (const studentId of convertToExternalIds) {
    try {
      const student = studentById.get(studentId);
      if (!student || student.boardingStatus !== 'half-boarder') continue;
      assertCanEditClassIn(access, student.classId);
      await db.students.put({
        ...student,
        boardingStatus: 'external',
        ...touchFields(actorId),
      });
      convertedToExternal++;
    } catch {
      continue;
    }
  }

  if (created > 0 || updated > 0 || convertedToExternal > 0) {
    emitAppDataChanged(['students'], { reason: 'upsert-half-boarders' });
  }

  return { created, updated, convertedToExternal };
}
