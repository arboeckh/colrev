import { describe, expect, it } from 'vitest';
import { isValidNumericDraft, sanitizeNumeric } from './numericInput';

const integer = { mode: 'integer' } as const;
const decimal = { mode: 'decimal' } as const;

describe('isValidNumericDraft', () => {
  it('accepts the partial states typing a number passes through', () => {
    expect(isValidNumericDraft('', integer)).toBe(true);
    expect(isValidNumericDraft('-', integer)).toBe(true);
    expect(isValidNumericDraft('12', integer)).toBe(true);
    expect(isValidNumericDraft('-3', integer)).toBe(true);
    expect(isValidNumericDraft('1.', decimal)).toBe(true);
    expect(isValidNumericDraft('.5', decimal)).toBe(true);
  });

  it('rejects anything that is not a number', () => {
    expect(isValidNumericDraft('1a', integer)).toBe(false);
    expect(isValidNumericDraft('1e5', decimal)).toBe(false);
    expect(isValidNumericDraft(' 1', integer)).toBe(false);
    expect(isValidNumericDraft('1 ', integer)).toBe(false);
  });

  it('rejects a decimal point in an integer field', () => {
    expect(isValidNumericDraft('1.5', integer)).toBe(false);
  });

  it('rejects a second decimal point and a misplaced minus', () => {
    expect(isValidNumericDraft('1.2.3', decimal)).toBe(false);
    expect(isValidNumericDraft('1-2', integer)).toBe(false);
    expect(isValidNumericDraft('--1', integer)).toBe(false);
  });

  it('rejects a minus where negatives are not allowed', () => {
    expect(isValidNumericDraft('-1', { mode: 'integer', allowNegative: false })).toBe(false);
  });
});

describe('sanitizeNumeric', () => {
  it('drops non-numeric characters', () => {
    expect(sanitizeNumeric('1,234', integer)).toBe('1234');
    expect(sanitizeNumeric('12 kg', integer)).toBe('12');
    expect(sanitizeNumeric('abc', integer)).toBe('');
  });

  it('keeps only a leading minus', () => {
    expect(sanitizeNumeric('-1-2', integer)).toBe('-12');
    expect(sanitizeNumeric('1-2', integer)).toBe('12');
    expect(sanitizeNumeric('-1.5', { mode: 'integer', allowNegative: false })).toBe('15');
  });

  it('keeps only the first decimal point, and none in an integer field', () => {
    expect(sanitizeNumeric('1.2.3', decimal)).toBe('1.23');
    expect(sanitizeNumeric('1.5', integer)).toBe('15');
    expect(sanitizeNumeric('-2.50', decimal)).toBe('-2.50');
  });
});
