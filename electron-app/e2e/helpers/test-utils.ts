import { Page } from '@playwright/test';

/**
 * Click a button after waiting for it to be enabled.
 *
 * IMPORTANT: Always use this for submit buttons that may be disabled
 * based on form validation. Playwright's click() will execute on disabled
 * buttons but won't trigger the action.
 */
export async function clickWhenEnabled(
  window: Page,
  selector: string,
  timeout = 5000,
): Promise<void> {
  await window.waitForSelector(`${selector}:not([disabled])`, { timeout });
  await window.click(selector);
}
