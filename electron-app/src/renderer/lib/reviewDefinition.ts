/** The parts of a review definition the user writes themselves. */
export interface DefinitionContent {
  objectives: string;
  protocol_url: string;
  keywords: string[];
  criteria: Record<string, unknown>;
}

/**
 * Whether the user has written anything into the review definition yet.
 *
 * The title is ignored: it is set when the project is created, so it says
 * nothing about whether the review has been defined. Objectives are rich-text
 * HTML, so an editor that was focused and cleared can leave markup with no
 * words in it.
 */
export function isDefinitionEmpty(definition: DefinitionContent): boolean {
  const objectivesText = definition.objectives
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return (
    objectivesText === '' &&
    definition.protocol_url.trim() === '' &&
    definition.keywords.length === 0 &&
    Object.keys(definition.criteria).length === 0
  );
}
