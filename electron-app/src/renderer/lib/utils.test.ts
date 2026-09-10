import { describe, it, expect } from 'vitest';
import { formatCount, countTextSizeClass, stripUrlUserinfo } from './utils';

describe('formatCount', () => {
  it('groups large numbers so they stay readable', () => {
    // Locale-agnostic: the digits survive and a separator appears.
    const formatted = formatCount(1234567);
    expect(formatted.replace(/\D/g, '')).toBe('1234567');
    expect(formatted.length).toBeGreaterThan(7);
  });

  it('leaves small numbers alone', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
  });

  it('renders missing counts as zero rather than blank or NaN', () => {
    expect(formatCount(null)).toBe('0');
    expect(formatCount(undefined)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
  });
});

describe('countTextSizeClass', () => {
  it('steps the type down as a count gains digits', () => {
    expect(countTextSizeClass(0)).toBe('text-3xl');
    expect(countTextSizeClass(99_999)).toBe('text-3xl');
    expect(countTextSizeClass(100_000)).toBe('text-2xl');
    expect(countTextSizeClass(1_000_000)).toBe('text-xl');
    expect(countTextSizeClass(98_765_432)).toBe('text-xl');
  });
});

describe('stripUrlUserinfo', () => {
  it('drops credentials from a remote URL', () => {
    expect(stripUrlUserinfo('https://x-access-token:secret@github.com/a/b.git')).toBe(
      'https://github.com/a/b.git',
    );
  });
});
