import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useBackendStore } from './backend';
import { useProjectsStore } from './projects';
import type {
  GetReviewDefinitionResponse,
  UpdateReviewDefinitionResponse,
  AddScreeningCriterionResponse,
  UpdateScreeningCriterionResponse,
  RemoveScreeningCriterionResponse,
  ReviewDefinitionData,
  ScreenCriterionDefinition,
} from '@/types/api';

export const useReviewDefinitionStore = defineStore('reviewDefinition', () => {
  const backend = useBackendStore();
  const projects = useProjectsStore();

  const definition = ref<ReviewDefinitionData | null>(null);
  const isLoading = ref(false);
  const isSaving = ref(false);

  async function loadDefinition() {
    if (!projects.currentProjectId || !backend.isRunning) return;

    isLoading.value = true;
    try {
      const response = await backend.call<GetReviewDefinitionResponse>(
        'get_review_definition',
        { project_id: projects.currentProjectId },
      );
      if (response.success) {
        definition.value = {
          review_type: response.review_type,
          title: response.title,
          protocol_url: response.protocol_url,
          keywords: response.keywords,
          objectives: response.objectives,
          criteria: response.criteria,
        };
      }
    } catch (err) {
      console.error('Failed to load review definition:', err);
    } finally {
      isLoading.value = false;
    }
  }

  async function updateDefinition(updates: {
    protocol_url?: string;
    keywords?: string[];
    objectives?: string;
  }) {
    if (!projects.currentProjectId || !backend.isRunning) return false;

    isSaving.value = true;
    try {
      const response = await backend.call<UpdateReviewDefinitionResponse>(
        'update_review_definition',
        {
          project_id: projects.currentProjectId,
          ...updates,
        },
      );
      if (response.success) {
        // Update local state
        if (definition.value) {
          if (updates.protocol_url !== undefined)
            definition.value.protocol_url = updates.protocol_url;
          if (updates.keywords !== undefined)
            definition.value.keywords = updates.keywords;
          if (updates.objectives !== undefined)
            definition.value.objectives = updates.objectives;
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update review definition:', err);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  async function addCriterion(params: {
    name: string;
    explanation: string;
    comment?: string;
    criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  }) {
    if (!projects.currentProjectId || !backend.isRunning) return false;

    isSaving.value = true;
    try {
      const response = await backend.call<AddScreeningCriterionResponse>(
        'add_screening_criterion',
        {
          project_id: projects.currentProjectId,
          ...params,
        },
      );
      if (response.success) {
        // Add to local state
        if (definition.value) {
          definition.value.criteria[params.name] = {
            explanation: params.explanation,
            comment: params.comment,
            criterion_type: params.criterion_type,
          };
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to add criterion:', err);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  async function updateCriterion(params: {
    criterion_name: string;
    explanation?: string;
    comment?: string;
    criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
  }) {
    if (!projects.currentProjectId || !backend.isRunning) return false;

    isSaving.value = true;
    try {
      const response = await backend.call<UpdateScreeningCriterionResponse>(
        'update_screening_criterion',
        {
          project_id: projects.currentProjectId,
          ...params,
        },
      );
      if (response.success && definition.value) {
        const criterion = definition.value.criteria[params.criterion_name];
        if (criterion) {
          if (params.explanation !== undefined)
            criterion.explanation = params.explanation;
          if (params.comment !== undefined) criterion.comment = params.comment;
          if (params.criterion_type !== undefined)
            criterion.criterion_type = params.criterion_type;
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update criterion:', err);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  async function removeCriterion(name: string) {
    if (!projects.currentProjectId || !backend.isRunning) return false;

    isSaving.value = true;
    try {
      const response = await backend.call<RemoveScreeningCriterionResponse>(
        'remove_screening_criterion',
        {
          project_id: projects.currentProjectId,
          criterion_name: name,
        },
      );
      if (response.success && definition.value) {
        delete definition.value.criteria[name];
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to remove criterion:', err);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  return {
    definition,
    isLoading,
    isSaving,
    loadDefinition,
    updateDefinition,
    addCriterion,
    updateCriterion,
    removeCriterion,
  };
});
