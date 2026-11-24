import { DomainError } from '@/utils/errors';
import { changePasswordHash, hashPassword } from '@/utils/password';
import { db } from './database';
import { newBaseFields, touchFields } from './records';
import { TEXT_MAX_LENGTH } from './studentRules';
import { MODULE_IDS, type AccessLevel, type SupervisorPermissions, type User, type UserStatus } from './types';

export function toUsernameKey(value: string): string {
  return value.trim().toLowerCase();
}

export function defaultPermissions(): SupervisorPermissions {
  const modules = Object.fromEntries(MODULE_IDS.map((id) => [id, 'view' as AccessLevel])) as SupervisorPermissions['modules'];
  return { assignedClasses: [], searchScope: 'assigned', modules };
}

export interface NewSupervisorInput {
  name: string;
  username: string;
  password: string;
  confirmPassword?: string;
}

export interface NewSupervisorValidationIssue {
  field: 'name' | 'username' | 'password' | 'confirmPassword';
  key: string;
}

export function validateNewSupervisorInput(input: NewSupervisorInput): NewSupervisorValidationIssue | null {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name === '') return { field: 'name', key: 'validation.required' };
  if (name.length > TEXT_MAX_LENGTH) return { field: 'name', key: 'validation.textTooLong' };

  const username = input.username.trim();
  if (username === '') return { field: 'username', key: 'validation.required' };
  if (username.length > TEXT_MAX_LENGTH) return { field: 'username', key: 'validation.textTooLong' };

  if (input.password.length < 6) return { field: 'password', key: 'validation.passwordShort' };
  if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
    return { field: 'confirmPassword', key: 'validation.passwordMismatch' };
  }
  return null;
}

export async function assertUsernameAvailable(usernameKey: string): Promise<void> {
  const taken = await db.users
    .where('usernameKey')
    .equals(usernameKey)
    .filter((user) => user.deletedAt == null)
    .count();
  if (taken > 0) {
    throw new DomainError('auth.errors.usernameTaken');
  }
}

export async function getActiveUser(userId: string): Promise<User> {
  const user = await db.users.get(userId);
  if (!user || user.deletedAt != null) {
    throw new DomainError('errors.notFound');
  }
  return user;
}

export async function assertHeadActor(actorId: string): Promise<User> {
  const actor = await getActiveUser(actorId);
  if (actor.role !== 'head') {
    throw new DomainError('errors.notAuthorized');
  }
  return actor;
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): Promise<void> {
  const user = await getActiveUser(userId);
  let passwordHash: string;
  try {
    passwordHash = await changePasswordHash(currentPassword, newPassword, confirmation, user.passwordHash);
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('validation.')) throw new DomainError(cause.message);
    throw new DomainError('settings.account.currentPasswordIncorrect');
  }
  await db.users.put({ ...user, passwordHash, ...touchFields(userId) });
}

export async function updateOwnDisplayName(userId: string, rawName: string): Promise<void> {
  const user = await getActiveUser(userId);
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name === '') throw new DomainError('validation.required');
  if (name.length > TEXT_MAX_LENGTH) throw new DomainError('validation.textTooLong');
  await db.users.put({ ...user, name, ...touchFields(userId) });
}

export async function listSupervisors(institutionId: string): Promise<User[]> {
  const users = await db.users.where('institutionId').equals(institutionId).toArray();
  return users
    .filter((user) => user.role === 'supervisor' && user.deletedAt == null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getSupervisor(userId: string, institutionId: string): Promise<User> {
  const user = await getActiveUser(userId);
  if (user.role !== 'supervisor' || user.institutionId !== institutionId) {
    throw new DomainError('errors.notFound');
  }
  return user;
}

export async function createSupervisor(
  institutionId: string,
  rawInput: NewSupervisorInput,
  actorId: string,
): Promise<User> {
  const actor = await assertHeadActor(actorId);
  if (actor.institutionId !== institutionId) {
    throw new DomainError('errors.notAuthorized');
  }

  const issue = validateNewSupervisorInput(rawInput);
  if (issue) {
    throw new DomainError(issue.key);
  }

  const name = rawInput.name.trim().replace(/\s+/g, ' ');
  const usernameKey = toUsernameKey(rawInput.username);
  // Derive PBKDF2 password hash before starting the Dexie transaction
  const passwordHash = await hashPassword(rawInput.password);

  return db.transaction('rw', db.users, async () => {
    await assertUsernameAvailable(usernameKey);
    const created: User = {
      ...newBaseFields(institutionId, actorId),
      name,
      usernameKey,
      passwordHash,
      role: 'supervisor',
      status: 'approved',
      permissions: defaultPermissions(),
    };
    await db.users.add(created);
    return created;
  });
}

export async function setSupervisorStatus(userId: string, status: UserStatus, actorId: string): Promise<void> {
  const actor = await assertHeadActor(actorId);
  const user = await getSupervisor(userId, actor.institutionId);
  await db.users.put({ ...user, status, ...touchFields(actorId) });
}

export async function updateSupervisorPermissions(
  userId: string,
  permissions: SupervisorPermissions,
  actorId: string,
): Promise<void> {
  const actor = await assertHeadActor(actorId);
  const user = await getSupervisor(userId, actor.institutionId);
  await db.users.put({ ...user, permissions, ...touchFields(actorId) });
}

export async function removeSupervisor(userId: string, actorId: string): Promise<void> {
  const actor = await assertHeadActor(actorId);
  const user = await getSupervisor(userId, actor.institutionId);
  const now = new Date().toISOString();
  await db.users.put({ ...user, deletedAt: now, ...touchFields(actorId) });
}
