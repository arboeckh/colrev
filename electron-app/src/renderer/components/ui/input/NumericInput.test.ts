/**
 * The guard has to hold in the DOM, not just in the emitted value: the bug this
 * component replaces was a sanitised emit that left the rejected character
 * sitting in the input, because the unchanged prop never forced a re-render.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NumericInput from './NumericInput.vue';
import type { NumericMode } from '@/lib/numericInput';

/** Type one character the way a browser does: beforeinput first, then input. */
function typeChar(input: HTMLInputElement, char: string): boolean {
  const before = new InputEvent('beforeinput', { data: char, inputType: 'insertText', cancelable: true });
  const allowed = input.dispatchEvent(before);
  if (allowed) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + char + input.value.slice(end);
    input.setSelectionRange(start + char.length, start + char.length);
    input.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText' }));
  }
  return allowed;
}

function mountInput(props: { mode: NumericMode; modelValue: string; allowNegative?: boolean }) {
  const wrapper = mount(NumericInput, { props, attachTo: document.body });
  const input = wrapper.element as HTMLInputElement;
  return { wrapper, input };
}

describe('NumericInput', () => {
  it('refuses a letter instead of showing it', () => {
    const { input } = mountInput({ mode: 'integer', modelValue: '' });

    typeChar(input, '4');
    expect(typeChar(input, 'a')).toBe(false);
    typeChar(input, '2');

    expect(input.value).toBe('42');
  });

  it('refuses a decimal point in an integer field but allows one in a decimal field', () => {
    const { input: int } = mountInput({ mode: 'integer', modelValue: '' });
    typeChar(int, '1');
    expect(typeChar(int, '.')).toBe(false);
    expect(int.value).toBe('1');

    const { input: dec } = mountInput({ mode: 'decimal', modelValue: '' });
    for (const c of '1.5') typeChar(dec, c);
    expect(dec.value).toBe('1.5');
    expect(typeChar(dec, '.')).toBe(false);
    expect(dec.value).toBe('1.5');
  });

  it('allows a leading minus only, and none when negatives are off', () => {
    const { input } = mountInput({ mode: 'integer', modelValue: '' });
    expect(typeChar(input, '-')).toBe(true);
    typeChar(input, '7');
    expect(typeChar(input, '-')).toBe(false);
    expect(input.value).toBe('-7');

    const { input: positive } = mountInput({ mode: 'integer', modelValue: '', allowNegative: false });
    expect(typeChar(positive, '-')).toBe(false);
    expect(positive.value).toBe('');
  });

  it('emits each accepted value and nothing for a refused keystroke', () => {
    const { wrapper, input } = mountInput({ mode: 'integer', modelValue: '' });

    typeChar(input, '1');
    typeChar(input, 'x');
    typeChar(input, '2');

    expect(wrapper.emitted('update:modelValue')).toEqual([['1'], ['12']]);
  });

  it('cleans a paste rather than dropping it', async () => {
    const { wrapper, input } = mountInput({ mode: 'integer', modelValue: '' });

    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '1,234 citations' } });
    input.dispatchEvent(paste);

    expect(input.value).toBe('1234');
    expect(wrapper.emitted('update:modelValue')).toEqual([['1234']]);
  });

  it('follows the prop when the parent changes the value', async () => {
    const { wrapper, input } = mountInput({ mode: 'decimal', modelValue: '1.5' });
    expect(input.value).toBe('1.5');

    await wrapper.setProps({ modelValue: '' });
    expect(input.value).toBe('');
  });
});
