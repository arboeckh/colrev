import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReviewsHero from './ReviewsHero.vue';

describe('ReviewsHero', () => {
  it('shows the number of reviews in progress', () => {
    const wrapper = mount(ReviewsHero, { props: { count: 3 } });

    expect(wrapper.get('[data-testid="reviews-hero-count"]').text()).toBe('3');
    expect(wrapper.text()).toContain('reviews in progress');
  });

  it('uses the singular for one review', () => {
    const wrapper = mount(ReviewsHero, { props: { count: 1 } });

    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('review in progress');
    expect(wrapper.text()).not.toContain('reviews in progress');
  });
});
