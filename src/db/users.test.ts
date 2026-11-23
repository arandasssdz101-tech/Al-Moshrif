import { describe, expect, it } from 'vitest';
import { TEXT_MAX_LENGTH } from './studentRules';
import { toUsernameKey, validateNewSupervisorInput } from './users';

describe('toUsernameKey', () => {
  it('trims whitespace and normalizes case', () => {
    expect(toUsernameKey('  Ahmed.Sup  ')).toBe('ahmed.sup');
    expect(toUsernameKey('  مشرف1  ')).toBe('مشرف1');
  });
});

describe('validateNewSupervisorInput', () => {
  it('accepts valid supervisor credentials', () => {
    expect(
      validateNewSupervisorInput({
        name: 'أحمد بن علي',
        username: 'ahmed.sup',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).toBeNull();
  });

  it('accepts valid input when confirmPassword is omitted', () => {
    expect(
      validateNewSupervisorInput({
        name: 'Sara',
        username: 'sara',
        password: 'secret!',
      }),
    ).toBeNull();
  });

  it('rejects empty or whitespace-only name', () => {
    expect(
      validateNewSupervisorInput({
        name: '   ',
        username: 'ahmed',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).toEqual({ field: 'name', key: 'validation.required' });
  });

  it('rejects overlong name', () => {
    expect(
      validateNewSupervisorInput({
        name: 'a'.repeat(TEXT_MAX_LENGTH + 1),
        username: 'ahmed',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).toEqual({ field: 'name', key: 'validation.textTooLong' });
  });

  it('rejects empty or whitespace-only username', () => {
    expect(
      validateNewSupervisorInput({
        name: 'Ahmed',
        username: '  ',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).toEqual({ field: 'username', key: 'validation.required' });
  });

  it('rejects overlong username', () => {
    expect(
      validateNewSupervisorInput({
        name: 'Ahmed',
        username: 'u'.repeat(TEXT_MAX_LENGTH + 1),
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).toEqual({ field: 'username', key: 'validation.textTooLong' });
  });

  it('rejects password shorter than 6 characters', () => {
    expect(
      validateNewSupervisorInput({
        name: 'Ahmed',
        username: 'ahmed',
        password: '12345',
        confirmPassword: '12345',
      }),
    ).toEqual({ field: 'password', key: 'validation.passwordShort' });
  });

  it('rejects mismatched password confirmation', () => {
    expect(
      validateNewSupervisorInput({
        name: 'Ahmed',
        username: 'ahmed',
        password: 'password123',
        confirmPassword: 'password456',
      }),
    ).toEqual({ field: 'confirmPassword', key: 'validation.passwordMismatch' });
  });
});
