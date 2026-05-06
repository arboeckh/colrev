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
