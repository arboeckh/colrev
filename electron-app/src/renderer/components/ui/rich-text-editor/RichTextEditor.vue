<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Heading,
  Type,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
} from 'lucide-vue-next';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
    minHeight?: string;
    class?: string;
  }>(),
  {
    placeholder: '',
    disabled: false,
    minHeight: '20rem',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const editor = useEditor({
  content: props.modelValue || '',
  editable: !props.disabled,
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3] },
    }),
    Placeholder.configure({
      placeholder: props.placeholder,
    }),
  ],
  editorProps: {
    attributes: {
      class: 'rte-content focus:outline-none',
    },
  },
  onUpdate: ({ editor: ed }) => {
    const html = ed.getHTML();
    emit('update:modelValue', html === '<p></p>' ? '' : html);
  },
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    const current = editor.value.getHTML();
    const normalized = val || '';
    if (normalized === current) return;
    if (normalized === '' && current === '<p></p>') return;
    editor.value.commands.setContent(normalized, { emitUpdate: false });
  },
);

watch(
  () => props.disabled,
  (v) => {
    editor.value?.setEditable(!v);
  },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});

function toggleMark(fn: () => void) {
  if (props.disabled) return;
  fn();
}
</script>

<template>
  <div
    :class="
      cn(
        'flex flex-col border border-input bg-transparent rounded focus-within:border-ring transition-colors',
        props.class,
      )
    "
  >
    <!-- Toolbar -->
    <div class="flex items-center gap-0.5 border-b border-border px-2 h-10">
      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 px-2 inline-flex items-center gap-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('heading', { level: 2 }) && 'bg-muted text-foreground',
        )"
        title="Heading"
        @click="toggleMark(() => editor?.chain().focus().toggleHeading({ level: 2 }).run())"
      >
        <Heading class="h-4 w-4" />
        <span class="text-xs">Heading</span>
      </button>
      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 px-2 inline-flex items-center gap-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('heading', { level: 3 }) && 'bg-muted text-foreground',
        )"
        title="Subheading"
        @click="toggleMark(() => editor?.chain().focus().toggleHeading({ level: 3 }).run())"
      >
        <Type class="h-4 w-4" />
        <span class="text-xs">Subheading</span>
      </button>

      <span class="mx-1 h-4 w-px bg-border" />

      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('bold') && 'bg-muted text-foreground',
        )"
        title="Bold"
        @click="toggleMark(() => editor?.chain().focus().toggleBold().run())"
      >
        <BoldIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('italic') && 'bg-muted text-foreground',
        )"
        title="Italic"
        @click="toggleMark(() => editor?.chain().focus().toggleItalic().run())"
      >
        <ItalicIcon class="h-4 w-4" />
      </button>

      <span class="mx-1 h-4 w-px bg-border" />

      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('bulletList') && 'bg-muted text-foreground',
        )"
        title="Bulleted list"
        @click="toggleMark(() => editor?.chain().focus().toggleBulletList().run())"
      >
        <List class="h-4 w-4" />
      </button>
      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('orderedList') && 'bg-muted text-foreground',
        )"
        title="Numbered list"
        @click="toggleMark(() => editor?.chain().focus().toggleOrderedList().run())"
      >
        <ListOrdered class="h-4 w-4" />
      </button>
      <button
        type="button"
        :disabled="disabled"
        :class="cn(
          'h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none',
          editor?.isActive('blockquote') && 'bg-muted text-foreground',
        )"
        title="Quote"
        @click="toggleMark(() => editor?.chain().focus().toggleBlockquote().run())"
      >
        <Quote class="h-4 w-4" />
      </button>

      <div class="flex-1" />

      <button
        type="button"
        :disabled="disabled || !editor?.can().undo()"
        class="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Undo"
        @click="toggleMark(() => editor?.chain().focus().undo().run())"
      >
        <Undo2 class="h-4 w-4" />
      </button>
      <button
        type="button"
        :disabled="disabled || !editor?.can().redo()"
        class="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Redo"
        @click="toggleMark(() => editor?.chain().focus().redo().run())"
      >
        <Redo2 class="h-4 w-4" />
      </button>
    </div>

    <!-- Content -->
    <EditorContent
      :editor="editor"
      :style="{ minHeight: minHeight }"
      class="rte-wrapper flex-1 px-5 py-4 text-base leading-relaxed overflow-auto"
    />
  </div>
</template>

<style scoped>
.rte-wrapper :deep(.rte-content) {
  min-height: inherit;
  outline: none;
}
.rte-wrapper :deep(.rte-content > *:first-child) {
  margin-top: 0;
}
.rte-wrapper :deep(.rte-content > *:last-child) {
  margin-bottom: 0;
}
.rte-wrapper :deep(p) {
  margin: 0 0 0.85rem;
}
.rte-wrapper :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 1.25rem 0 0.5rem;
  line-height: 1.3;
}
.rte-wrapper :deep(h3) {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.rte-wrapper :deep(ul),
.rte-wrapper :deep(ol) {
  margin: 0 0 0.85rem;
  padding-left: 1.25rem;
}
.rte-wrapper :deep(ul) { list-style: disc; }
.rte-wrapper :deep(ol) { list-style: decimal; }
.rte-wrapper :deep(li) { margin: 0.2rem 0; }
.rte-wrapper :deep(li > p) { margin: 0; }
.rte-wrapper :deep(strong) { font-weight: 600; }
.rte-wrapper :deep(em) { font-style: italic; }
.rte-wrapper :deep(code) {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.9em;
  background: var(--color-muted);
  padding: 0.1em 0.35em;
  border-radius: 3px;
}
.rte-wrapper :deep(blockquote) {
  border-left: 2px solid var(--color-border);
  padding: 0.1rem 0 0.1rem 1rem;
  margin: 0 0 0.85rem;
  color: var(--color-muted-foreground);
}
.rte-wrapper :deep(p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-muted-foreground);
  pointer-events: none;
  height: 0;
}
</style>
