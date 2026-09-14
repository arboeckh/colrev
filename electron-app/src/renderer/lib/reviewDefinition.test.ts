import { describe, it, expect } from 'vitest';
import { isDefinitionEmpty, type DefinitionContent } from './reviewDefinition';

function definition(overrides: Partial<DefinitionContent> = {}): DefinitionContent {
  return { objectives: '', protocol_url: '', keywords: [], criteria: {}, ...overrides };
}

describe('isDefinitionEmpty', () => {
  it('is empty for a freshly created review', () => {
    expect(isDefinitionEmpty(definition())).toBe(true);
  });

  it('treats objectives that are only markup or whitespace as empty', () => {
    expect(isDefinitionEmpty(definition({ objectives: '<p> &nbsp; </p><p></p>' }))).toBe(true);
  });

  it('is defined once objectives have words', () => {
    expect(isDefinitionEmpty(definition({ objectives: '<p>How does X affect Y?</p>' }))).toBe(
      false,
    );
  });

  it('is defined once a criterion exists', () => {
    expect(isDefinitionEmpty(definition({ criteria: { english: {} } }))).toBe(false);
  });

  it('is defined once a protocol URL or keyword is set', () => {
    expect(isDefinitionEmpty(definition({ protocol_url: 'https://prospero' }))).toBe(false);
    expect(isDefinitionEmpty(definition({ keywords: ['ai'] }))).toBe(false);
  });
});
