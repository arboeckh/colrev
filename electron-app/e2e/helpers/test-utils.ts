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

export interface OverflowFinding {
  selector: string;
  text: string;
  overflowPx: number;
}

/**
 * Report elements inside `selector` that stick out sideways of their own parent.
 *
 * Content the UI renders is unbounded — source filenames, record counts in the
 * millions, backend status strings — so the layout has to absorb it by
 * wrapping, truncating or scrolling. Anything that instead spills past its
 * container is a layout bug, and this is how a test sees one.
 *
 * Elements inside a scroll container are skipped: overflowing a box that
 * scrolls is the intended escape hatch, not a defect.
 */
export async function findHorizontalOverflow(
  window: Page,
  selector: string,
): Promise<OverflowFinding[]> {
  return window.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`findHorizontalOverflow: no element matches ${sel}`);
    const findings: OverflowFinding[] = [];
    root.querySelectorAll('*').forEach((el) => {
      const parent = el.parentElement;
      if (!parent) return;
      const style = getComputedStyle(el);
      if (style.display === 'none') return;
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.overflowX !== 'visible') return;
      if (parentStyle.position !== 'static' && style.position === 'absolute') return;
      const box = el.getBoundingClientRect();
      const parentBox = parent.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return;
      const overflowPx = Math.max(box.right - parentBox.right, parentBox.left - box.left);
      if (overflowPx > 1) {
        findings.push({
          selector: `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(/\s+/).slice(0, 3).join('.')}`,
          text: (el.textContent ?? '').trim().slice(0, 40),
          overflowPx: Math.round(overflowPx),
        });
      }
    });
    return findings;
  }, selector);
}
