import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ screen: {} }));

import { parseScaleLine, zoomFor } from './preview-display';

describe('parseScaleLine', () => {
  it('reads the scale of a `scale <n>` line', () => {
    expect(parseScaleLine('scale 2')).toBe(2);
    expect(parseScaleLine('scale 1.25\r')).toBe(1.25);
  });

  it('ignores anything else, and scales out of range', () => {
    expect(parseScaleLine('')).toBeNull();
    expect(parseScaleLine('zoom 2')).toBeNull();
    expect(parseScaleLine('scale -1')).toBeNull();
    expect(parseScaleLine('scale 0.1')).toBeNull();
    expect(parseScaleLine('scale 9')).toBeNull();
    expect(parseScaleLine('scale 2 3')).toBeNull();
  });
});

describe('zoomFor', () => {
  it('makes up the difference between the asked scale and the device scale factor', () => {
    expect(zoomFor(2, 2)).toBe(1);
    expect(zoomFor(1, 2)).toBe(0.5);
    expect(zoomFor(1.5, 2)).toBe(0.75);
  });

  it('takes a device scale factor it cannot use as 1', () => {
    expect(zoomFor(2, 0)).toBe(2);
  });
});
