import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip `user[:pass]@` userinfo from an HTTPS URL. Defends against an
 * authenticated git remote URL (e.g. `https://x-access-token:TOKEN@github.com/...`)
 * leaking into the DOM if a backend ever reports one.
 */
export function stripUrlUserinfo(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@]*@/i, '$1');
}

/**
 * Render a record count for display.
 *
 * Counts come from the backend unbounded — a review with a million records is
 * unusual but not impossible — so grouping separators are what keep a long
 * number readable inside a narrow card.
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat().format(value);
}

/**
 * Type-scale step for a headline number, so a 7-digit count does not blow out
 * the card that a 3-digit one sits comfortably in.
 */
export function countTextSizeClass(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString().length;
  if (digits >= 7) return 'text-xl';
  if (digits >= 6) return 'text-2xl';
  return 'text-3xl';
}
