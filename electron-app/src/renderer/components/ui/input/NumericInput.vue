<script setup lang="ts">
/**
 * An <Input> that only ever *contains* a number.
 *
 * The plain <Input> binds through a passive `useVModel`, so a parent that
 * sanitises the emitted value cannot pull a rejected character back out of the
 * DOM: when the sanitised value equals the previous one the prop never changes
 * and the input keeps showing the junk. This component guards at entry instead
 * — an insertion that would make the field non-numeric is refused before it
 * lands, and a paste is cleaned rather than dropped.
 */
import { onMounted, ref, useAttrs, watch, type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';
import { isValidNumericDraft, sanitizeNumeric, type NumericMode } from '@/lib/numericInput';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    mode: NumericMode;
    allowNegative?: boolean;
    class?: HTMLAttributes['class'];
  }>(),
  { modelValue: '', allowNegative: true },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const attrs = useAttrs();
const el = ref<HTMLInputElement | null>(null);

const constraints = () => ({ mode: props.mode, allowNegative: props.allowNegative });

/** Keep the DOM in step with the prop, including when our own emit is ignored. */
function syncFromProp() {
  const input = el.value;
  if (input && input.value !== props.modelValue) input.value = props.modelValue;
}

onMounted(syncFromProp);
watch(() => props.modelValue, syncFromProp);

/** Refuse any insertion whose result would not be a number. */
function onBeforeInput(event: InputEvent) {
  const input = event.target as HTMLInputElement;
  const inserted = event.data;
  // Deletions, undo and the like carry no data and can never introduce junk.
  if (inserted == null) return;

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + inserted + input.value.slice(end);
  if (!isValidNumericDraft(next, constraints())) event.preventDefault();
}

/** Paste is cleaned instead of refused: "1,234" should land as 1234. */
function onPaste(event: ClipboardEvent) {
  event.preventDefault();
  const input = event.target as HTMLInputElement;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const pasted = sanitizeNumeric(event.clipboardData?.getData('text') ?? '', constraints());

  const merged = sanitizeNumeric(input.value.slice(0, start) + pasted + input.value.slice(end), constraints());
  input.value = merged;
  const caret = Math.min(start + pasted.length, merged.length);
  input.setSelectionRange(caret, caret);
  emit('update:modelValue', merged);
}

/**
 * Backstop for input paths that skip beforeinput (autofill, some IMEs): clean
 * the value in place, keeping the caret where the user left it.
 */
function onInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const cleaned = sanitizeNumeric(input.value, constraints());
  if (cleaned !== input.value) {
    const caret = Math.max(0, (input.selectionStart ?? cleaned.length) - (input.value.length - cleaned.length));
    input.value = cleaned;
    input.setSelectionRange(caret, caret);
  }
  emit('update:modelValue', cleaned);
}
</script>

<template>
  <input
    ref="el"
    v-bind="attrs"
    type="text"
    :inputmode="mode === 'integer' ? 'numeric' : 'decimal'"
    data-slot="input"
    :class="cn(
      'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input h-9 w-full min-w-0 rounded-md border bg-card px-3 py-1 text-base transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
      props.class,
    )"
    @beforeinput="onBeforeInput"
    @paste="onPaste"
    @input="onInput"
  >
</template>
