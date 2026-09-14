/**
 * The queue map exists because the bar it replaced rendered one DOM node per
 * queued record: at a few hundred records the segments went sub-pixel and the
 * only way to move was to drag a thumb. The invariant worth protecting is that
 * the node count is bounded by the available width, not by the queue length —
 * and that every record stays reachable regardless of how records are binned.
 *
 * Logic only — no pixel assertions.
 */
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QueueMap, { type QueueDecision, type QueueMapItem } from './QueueMap.vue';

const TRACK_WIDTH = 600;
// Mirrors MIN_BAR_PX / BINNED_GAP_PX in the component.
const MAX_BARS = Math.floor((TRACK_WIDTH + 1) / (6 + 1));
// Mirrors MAX_BAR_PX / DISCRETE_GAP_PX: the most records that still fit as
// fixed-size tiles.
const MAX_DISCRETE = Math.floor((TRACK_WIDTH + 4) / (20 + 4));

function items(count: number, decide: (i: number) => QueueDecision = () => 'undecided') {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i}`, decision: decide(i) }));
}

interface MapProps {
  items: QueueMapItem[];
  currentIndex: number;
  testIdPrefix?: string;
  showCounter?: boolean;
  decidedCount?: number;
  totalCount?: number;
}

async function mountMap(props: MapProps) {
  const wrapper = mount(QueueMap, { props, attachTo: document.body });
  // The track measures itself on mount; let that first re-render land.
  await nextTick();
  return wrapper;
}

function bars(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-testid^="prescreen-queue-map-bin-"]');
}

function mode(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('[data-testid="prescreen-queue-map"]').attributes('data-mode');
}

function windowBar(wrapper: ReturnType<typeof mount>) {
  const el = wrapper.get('[data-testid="prescreen-queue-map-window"]');
  return {
    index: Number(el.attributes('data-bar-index')),
    barCount: Number(el.attributes('data-bar-count')),
  };
}

beforeEach(() => {
  // happy-dom lays nothing out, so every element measures 0x0 and the
  // component would fall back to one bar per record. Stand in for a laid-out
  // track: the binning is a pure function of this width.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(TRACK_WIDTH);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: TRACK_WIDTH,
    height: 24,
    right: TRACK_WIDTH,
    bottom: 24,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('layout modes', () => {
  it('lays a single record out as one fixed-size tile, not a full-width bar', async () => {
    const wrapper = await mountMap({ items: items(1), currentIndex: 0 });
    expect(mode(wrapper)).toBe('discrete');
    expect(bars(wrapper)).toHaveLength(1);
    const row = wrapper.get('[data-testid="prescreen-queue-map-bin-0"]').element.parentElement;
    expect(row?.getAttribute('style')).toContain('width: 20px');
  });

  it('keeps short queues as tiles while they fit', async () => {
    const wrapper = await mountMap({ items: items(MAX_DISCRETE), currentIndex: 0 });
    expect(mode(wrapper)).toBe('discrete');
    expect(bars(wrapper)).toHaveLength(MAX_DISCRETE);
  });

  it('stretches one bar per record once tiles no longer fit', async () => {
    const wrapper = await mountMap({ items: items(MAX_DISCRETE + 1), currentIndex: 0 });
    expect(mode(wrapper)).toBe('fill');
    expect(bars(wrapper)).toHaveLength(MAX_DISCRETE + 1);
  });

  it('bins records once a bar per record would be too thin', async () => {
    const wrapper = await mountMap({ items: items(MAX_BARS + 1), currentIndex: 0 });
    expect(mode(wrapper)).toBe('binned');
    expect(bars(wrapper).length).toBeLessThanOrEqual(MAX_BARS);
  });
});

describe('binning', () => {
  it('renders one bar per record while the queue is short', async () => {
    const wrapper = await mountMap({ items: items(12), currentIndex: 0 });
    expect(bars(wrapper)).toHaveLength(12);
  });

  it('caps the bar count once the queue outgrows the track', async () => {
    const wrapper = await mountMap({ items: items(4000), currentIndex: 0 });
    const rendered = bars(wrapper).length;
    expect(rendered).toBe(MAX_BARS);
    expect(rendered).toBeLessThan(4000);
  });

  it('holds the bar count flat as the queue grows', async () => {
    const wrapper = await mountMap({ items: items(2000), currentIndex: 0 });
    const atTwoThousand = bars(wrapper).length;
    await wrapper.setProps({ items: items(20000) });
    expect(bars(wrapper).length).toBe(atTwoThousand);
  });

  it('reports how many records a bar stands for', async () => {
    const wrapper = await mountMap({ items: items(2412), currentIndex: 0, totalCount: 2412 });
    const scale = wrapper.get('[data-testid="prescreen-queue-map-scale"]');
    expect(scale.text()).toContain(String(Math.round(2412 / MAX_BARS)));
  });

  it('hides the scale hint when a bar is a single record', async () => {
    const wrapper = await mountMap({ items: items(12), currentIndex: 0 });
    expect(wrapper.find('[data-testid="prescreen-queue-map-scale"]').exists()).toBe(false);
  });
});

describe('the viewport window', () => {
  it('sits over the bar holding the current record', async () => {
    const count = 2000;
    const wrapper = await mountMap({ items: items(count), currentIndex: 0 });
    const barCount = bars(wrapper).length;

    await wrapper.setProps({ currentIndex: 1000 });
    const window = windowBar(wrapper);

    expect(window.barCount).toBe(barCount);
    expect(window.index).toBe(Math.floor((1000 * barCount) / count));
  });

  it('stays on the last bar at the last record', async () => {
    const wrapper = await mountMap({ items: items(2000), currentIndex: 1999 });
    const { index, barCount } = windowBar(wrapper);
    expect(index).toBe(barCount - 1);
  });

  it('frames the only record in a queue of one', async () => {
    const wrapper = await mountMap({ items: items(1), currentIndex: 0 });
    const { index, barCount } = windowBar(wrapper);
    expect(index).toBe(0);
    expect(barCount).toBe(1);
  });
});

describe('seeking', () => {
  it('seeks to the record under the pointer, not to the bar index', async () => {
    const count = 2000;
    const wrapper = await mountMap({ items: items(count), currentIndex: 0 });

    // Halfway along the track.
    await wrapper
      .get('[data-testid="prescreen-queue-map"]')
      .trigger('pointerdown', { clientX: TRACK_WIDTH / 2, pointerId: 1 });

    const seeks = wrapper.emitted('seek');
    expect(seeks).toHaveLength(1);
    expect(seeks?.[0][0]).toBe(Math.floor(count / 2));
  });

  it('seeks the last record when a short queue is clicked past its tiles', async () => {
    const wrapper = await mountMap({ items: items(3), currentIndex: 0 });
    const row = wrapper.get('[data-testid="prescreen-queue-map-bin-0"]').element.parentElement!;
    // The row of three tiles is 68px wide; click well to the right of it.
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 68,
    } as DOMRect);

    await wrapper
      .get('[data-testid="prescreen-queue-map"]')
      .trigger('pointerdown', { clientX: 400, pointerId: 1 });

    expect(wrapper.emitted('seek')?.[0][0]).toBe(2);
  });

  it('can reach the last record at the right edge', async () => {
    const count = 2412;
    const wrapper = await mountMap({ items: items(count), currentIndex: 0 });

    await wrapper
      .get('[data-testid="prescreen-queue-map"]')
      .trigger('pointerdown', { clientX: TRACK_WIDTH, pointerId: 1 });

    expect(wrapper.emitted('seek')?.[0][0]).toBe(count - 1);
  });

  it('ignores pointer input on an empty queue', async () => {
    const wrapper = await mountMap({ items: [], currentIndex: 0 });
    await wrapper
      .get('[data-testid="prescreen-queue-map"]')
      .trigger('pointerdown', { clientX: 10, pointerId: 1 });
    expect(wrapper.emitted('seek')).toBeUndefined();
  });
});

describe('decision mix', () => {
  it('splits a bar by the decisions of the records it covers', async () => {
    // 2000 records: the first half included, the rest undecided.
    const wrapper = await mountMap({
      items: items(2000, (i) => (i < 1000 ? 'included' : 'undecided')),
      currentIndex: 0,
    });
    const rendered = bars(wrapper);

    const firstBar = rendered[0].findAll('div');
    // undecided / excluded / included, in that stacking order.
    expect(firstBar[0].attributes('style')).toContain('height: 0%');
    expect(firstBar[2].attributes('style')).toContain('height: 100%');

    const lastBar = rendered[rendered.length - 1].findAll('div');
    expect(lastBar[0].attributes('style')).toContain('height: 100%');
    expect(lastBar[2].attributes('style')).toContain('height: 0%');
  });
});
