<script setup lang="ts">
import { ref, computed } from 'vue';
import { Check, X, Search, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import type { GetRecordsResponse, UpdateScreenDecisionsResponse } from '@/types/api';

interface EditRecord {
  id: string;
  title: string;
  author: string;
  year: string;
  originalDecision: 'include' | 'exclude';
  newDecision: 'include' | 'exclude';
}

const emit = defineEmits<{
  close: [];
}>();

const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();

const editRecords = ref<EditRecord[]>([]);
const editSearchText = ref('');
const isLoading = ref(true);
const isSaving = ref(false);

const filteredEditRecords = computed(() => {
  if (!editSearchText.value) return editRecords.value;
  const q = editSearchText.value.toLowerCase();
  return editRecords.value.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.author.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
  );
});

const editChangesCount = computed(
  () => editRecords.value.filter((r) => r.newDecision !== r.originalDecision).length,
);

async function loadEditRecords() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
      project_id: projects.currentProjectId,
      filters: { status: ['rev_included', 'rev_excluded'] },
      pagination: { offset: 0, limit: 500 },
      fields: ['ID', 'title', 'author', 'year', 'colrev_status'],
    });

    if (response.success) {
      editRecords.value = response.records.map((r: any) => {
        const isIncluded = r.colrev_status === 'rev_included';
        return {
          id: r.ID,
          title: r.title || '',
          author: r.author || '',
          year: r.year || '',
          originalDecision: isIncluded ? 'include' : 'exclude',
          newDecision: isIncluded ? 'include' : 'exclude',
        } as EditRecord;
      });
    }
  } catch (err) {
    console.error('Failed to load records for edit mode:', err);
    notifications.error('Failed to load records', err instanceof Error ? err.message : 'Unknown error');
    emit('close');
  } finally {
    isLoading.value = false;
  }
}

function toggleDecision(recordId: string) {
  const record = editRecords.value.find((r) => r.id === recordId);
  if (!record) return;
  record.newDecision = record.newDecision === 'include' ? 'exclude' : 'include';
}

async function saveEdits() {
  if (!projects.currentProjectId || isSaving.value) return;

  const changed = editRecords.value.filter((r) => r.newDecision !== r.originalDecision);
  if (changed.length === 0) return;

  isSaving.value = true;
  try {
    const response = await backend.call<UpdateScreenDecisionsResponse>(
      'update_screen_decisions',
      {
        project_id: projects.currentProjectId,
        changes: changed.map((r) => ({
          record_id: r.id,
          decision: r.newDecision,
        })),
      },
    );

    if (response.success) {
      notifications.success(
        'Decisions updated',
        `${response.changes_count} record(s) updated`,
      );
      await projects.refreshCurrentProject();
      emit('close');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Save failed', message);
  } finally {
    isSaving.value = false;
  }
}

// Load records on mount
loadEditRecords();
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0" data-testid="screen-edit-mode">
    <!-- Edit mode header -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <h3 class="text-base font-medium">Edit Screen Decisions</h3>
        <Badge v-if="editChangesCount > 0" variant="secondary" class="px-2 py-0.5">
          {{ editChangesCount }} change{{ editChangesCount !== 1 ? 's' : '' }}
        </Badge>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          data-testid="screen-edit-cancel-btn"
          @click="emit('close')"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="screen-edit-save-btn"
          :disabled="editChangesCount === 0 || isSaving"
          @click="saveEdits"
        >
          <Loader2 v-if="isSaving" class="h-4 w-4 mr-1.5 animate-spin" />
          Save {{ editChangesCount }} change{{ editChangesCount !== 1 ? 's' : '' }}
        </Button>
      </div>
    </div>

    <!-- Search input -->
    <div class="relative mb-3">
      <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        v-model="editSearchText"
        placeholder="Filter by title, author, or ID..."
        class="pl-9"
        data-testid="screen-edit-search"
      />
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <!-- Records table -->
    <ScrollArea v-else class="flex-1">
      <Table class="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead class="w-[45%]">Title</TableHead>
            <TableHead class="w-[25%]">Authors</TableHead>
            <TableHead class="w-[50px]">Year</TableHead>
            <TableHead class="w-[110px] text-right">Decision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="record in filteredEditRecords"
            :key="record.id"
            :class="{ 'bg-muted/50': record.newDecision !== record.originalDecision }"
            :data-testid="`screen-edit-row-${record.id}`"
          >
            <TableCell class="overflow-hidden">
              <div class="font-medium text-sm leading-tight truncate">{{ record.title }}</div>
              <div class="text-xs text-muted-foreground font-mono mt-0.5 truncate">{{ record.id }}</div>
            </TableCell>
            <TableCell class="text-sm overflow-hidden">
              <span class="block truncate">{{ record.author }}</span>
            </TableCell>
            <TableCell class="text-sm">{{ record.year }}</TableCell>
            <TableCell class="text-right">
              <Button
                size="sm"
                variant="outline"
                :class="
                  record.newDecision === 'include'
                    ? 'border-green-600/50 text-green-500 hover:bg-green-600/10'
                    : 'border-destructive/50 text-red-400 hover:bg-destructive/10'
                "
                :data-testid="`screen-edit-toggle-${record.id}`"
                @click="toggleDecision(record.id)"
              >
                <Check v-if="record.newDecision === 'include'" class="h-3.5 w-3.5 mr-1" />
                <X v-else class="h-3.5 w-3.5 mr-1" />
                {{ record.newDecision === 'include' ? 'Included' : 'Excluded' }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ScrollArea>
  </div>
</template>
