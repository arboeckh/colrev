export type NumericMode = 'integer' | 'decimal';

export interface NumericConstraints {
  mode: NumericMode;
  allowNegative?: boolean;
}

/**
 * Whether `value` is a legal *in-progress* entry: complete numbers plus the
 * partial states a user necessarily passes through while typing ('', '-', '1.').
 */
export function isValidNumericDraft(value: string, { mode, allowNegative = true }: NumericConstraints): boolean {
  const sign = allowNegative ? '-?' : '';
  const body = mode === 'integer' ? '\\d*' : '\\d*(\\.\\d*)?';
  return new RegExp(`^${sign}${body}$`).test(value);
}

/** Strip everything that cannot belong to a number of this type. */
export function sanitizeNumeric(raw: string, { mode, allowNegative = true }: NumericConstraints): string {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  const digitsAndPoint = raw.replace(mode === 'integer' ? /[^\d]/g : /[^\d.]/g, '');

  let unsigned = digitsAndPoint;
  if (mode === 'decimal') {
    const [first, ...rest] = digitsAndPoint.split('.');
    unsigned = rest.length > 0 ? `${first}.${rest.join('')}` : first;
  }

  return negative ? `-${unsigned}` : unsigned;
}
