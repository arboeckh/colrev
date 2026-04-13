/**
 * Semantic 3-way merge for structured project files.
 *
 * Handles settings.json at field level, records.bib at record level,
 * and falls back to file-level comparison for other files.
 */

// --- Types ---

export interface ConflictItem {
  id: string;
  file: string;
  path: string;
  label: string;
  description?: string;
  localValue: unknown;
  remoteValue: unknown;
  localLabel?: string;
  remoteLabel?: string;
}

export interface AutoMergedChange {
  label: string;
  source: 'local' | 'remote';
}

export interface FileResolution {
  content: string;
  needsResolution: boolean;
}

export interface MergeAnalysis {
  hasConflicts: boolean;
  conflicts: ConflictItem[];
  autoMerged: AutoMergedChange[];
  fileResults: Record<string, FileResolution>;
}

export interface ConflictResolution {
  id: string;
  choice: 'local' | 'remote';
}

// --- Settings field label mapping ---

const FIELD_LABELS: Record<string, string> = {
  'project.title': 'Review Title',
  'project.review_type': 'Review Type',
  'project.authors': 'Authors',
  'project.keywords': 'Keywords',
  'project.protocol': 'Protocol',
  'project.protocol.url': 'Protocol URL',
  'project.id_pattern': 'ID Pattern',
  'project.share_stat_req': 'Sharing Requirement',
  'project.delay_automated_processing': 'Delay Automated Processing',
  'project.colrev_version': 'CoLRev Version',
  'project.auto_upgrade': 'Auto Upgrade',
  'sources': 'Search Sources',
  'search.retrieve_forthcoming': 'Retrieve Forthcoming Papers',
  'prep.fields_to_keep': 'Fields to Keep',
  'prep.prep_rounds': 'Preparation Rounds',
  'prep.defects_to_ignore': 'Defects to Ignore',
  'dedupe.dedupe_package_endpoints': 'Deduplication Settings',
  'prescreen.explanation': 'Prescreen Instructions',
  'prescreen.prescreen_package_endpoints': 'Prescreen Settings',
  'pdf_get.pdf_path_type': 'PDF Path Type',
  'pdf_get.pdf_required_for_screen_and_synthesis': 'Require PDFs for Screening',
  'pdf_get.rename_pdfs': 'Rename PDFs',
  'pdf_prep.keep_backup_of_pdfs': 'Keep PDF Backups',
  'screen.explanation': 'Screening Instructions',
  'screen.criteria': 'Screening Criteria',
  'screen.screen_package_endpoints': 'Screening Settings',
  'data.data_package_endpoints': 'Data Extraction Settings',
};

function getFieldLabel(jsonPath: string): string {
  // Exact match
  if (FIELD_LABELS[jsonPath]) return FIELD_LABELS[jsonPath];

  // Pattern match for array items: sources[key].field
  const sourceMatch = jsonPath.match(/^sources\[(.+?)\]\.(.+)$/);
  if (sourceMatch) {
    const key = sourceMatch[1];
    const field = sourceMatch[2].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    // Extract just the filename part for readability
    const shortKey = key.includes('/') ? key.split('/').pop() : key;
    return `Source "${shortKey}" > ${field}`;
  }
  const sourceTopMatch = jsonPath.match(/^sources\[(.+?)\]$/);
  if (sourceTopMatch) {
    const key = sourceTopMatch[1];
    const shortKey = key.includes('/') ? key.split('/').pop() : key;
    return `Search Source "${shortKey}"`;
  }

  // Pattern match for author items
  const authorMatch = jsonPath.match(/^project\.authors\[(.+?)\]\.(.+)$/);
  if (authorMatch) {
    const field = authorMatch[2].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `Author "${authorMatch[1]}" > ${field}`;
  }

  // Pattern match for criteria items
  const criteriaMatch = jsonPath.match(/^screen\.criteria\.(.+)$/);
  if (criteriaMatch) {
    return `Screening Criterion "${criteriaMatch[1]}"`;
  }

  // Pattern match for prep rounds
  const prepRoundMatch = jsonPath.match(/^prep\.prep_rounds\[(\d+)\]\.(.+)$/);
  if (prepRoundMatch) {
    const field = prepRoundMatch[2].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `Prep Round ${parseInt(prepRoundMatch[1]) + 1} > ${field}`;
  }

  // Fallback: split on dots, replace underscores, title-case
  return jsonPath
    .split('.')
    .map((seg) =>
      seg
        .replace(/\[.*\]/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(' > ');
}

// --- JSON flattening for 3-way diff ---

/** Natural key fields for arrays of objects */
const ARRAY_NATURAL_KEYS: Record<string, string> = {
  sources: 'filename',
  'project.authors': 'name',
};

function findNaturalKey(parentPath: string, item: Record<string, unknown>): string {
  const keyField = ARRAY_NATURAL_KEYS[parentPath];
  if (keyField && item[keyField] != null) {
    return String(item[keyField]);
  }
  // No natural key, shouldn't reach here for keyed arrays
  return '';
}

function isObjectArray(parentPath: string): boolean {
  return parentPath in ARRAY_NATURAL_KEYS;
}

/**
 * Flatten a JSON object to a map of dotted paths → values.
 * Arrays of objects with natural keys use keyed paths: sources[data/search/pubmed.bib]
 * Simple arrays and leaf values are treated as atomic.
 */
function flattenJson(
  obj: unknown,
  prefix = '',
): Map<string, unknown> {
  const result = new Map<string, unknown>();

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    if (prefix) result.set(prefix, obj);
    return result;
  }

  if (Array.isArray(obj)) {
    if (prefix && isObjectArray(prefix)) {
      // Array of objects with natural keys
      for (const item of obj) {
        if (typeof item === 'object' && item !== null) {
          const key = findNaturalKey(prefix, item as Record<string, unknown>);
          if (key) {
            const itemPrefix = `${prefix}[${key}]`;
            for (const [k, v] of flattenJson(item, itemPrefix)) {
              result.set(k, v);
            }
            continue;
          }
        }
      }
      // Also store the array of keys for detecting additions/removals
      const keys = obj
        .filter((item) => typeof item === 'object' && item !== null)
        .map((item) => findNaturalKey(prefix, item as Record<string, unknown>));
      result.set(`${prefix}.__keys__`, keys);
    } else {
      // Simple array: treat as atomic value
      result.set(prefix, obj);
    }
    return result;
  }

  // Regular object
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newPrefix = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recurse into nested objects
      for (const [k, v] of flattenJson(value, newPrefix)) {
        result.set(k, v);
      }
    } else if (Array.isArray(value) && isObjectArray(newPrefix)) {
      // Array of objects with natural keys
      for (const [k, v] of flattenJson(value, newPrefix)) {
        result.set(k, v);
      }
    } else {
      // Leaf value (including simple arrays)
      result.set(newPrefix, value);
    }
  }

  return result;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- Settings 3-way merge ---

export function analyzeSettingsConflict(
  baseJson: Record<string, unknown>,
  localJson: Record<string, unknown>,
  remoteJson: Record<string, unknown>,
): { conflicts: ConflictItem[]; autoMerged: AutoMergedChange[]; mergedResult: Record<string, unknown> } {
  const baseFlat = flattenJson(baseJson);
  const localFlat = flattenJson(localJson);
  const remoteFlat = flattenJson(remoteJson);

  const conflicts: ConflictItem[] = [];
  const autoMerged: AutoMergedChange[] = [];

  // Start with local as the base for merged result
  const mergedResult = JSON.parse(JSON.stringify(localJson));

  // Collect all paths
  const allPaths = new Set<string>();
  for (const k of baseFlat.keys()) allPaths.add(k);
  for (const k of localFlat.keys()) allPaths.add(k);
  for (const k of remoteFlat.keys()) allPaths.add(k);

  // Skip internal __keys__ paths for conflict detection
  for (const path of allPaths) {
    if (path.endsWith('.__keys__')) continue;

    const baseVal = baseFlat.get(path);
    const localVal = localFlat.get(path);
    const remoteVal = remoteFlat.get(path);

    const localChanged = !valuesEqual(localVal, baseVal);
    const remoteChanged = !valuesEqual(remoteVal, baseVal);

    if (!localChanged && !remoteChanged) {
      // No change
      continue;
    }

    if (localChanged && !remoteChanged) {
      // Only local changed — already in mergedResult
      autoMerged.push({ label: getFieldLabel(path), source: 'local' });
      continue;
    }

    if (!localChanged && remoteChanged) {
      // Only remote changed — apply to merged result
      autoMerged.push({ label: getFieldLabel(path), source: 'remote' });
      setNestedValue(mergedResult, path, remoteVal);
      continue;
    }

    // Both changed
    if (valuesEqual(localVal, remoteVal)) {
      // Both changed to same value — no conflict
      autoMerged.push({ label: getFieldLabel(path), source: 'local' });
      continue;
    }

    // CONFLICT: both changed to different values
    conflicts.push({
      id: `settings:${path}`,
      file: 'settings.json',
      path,
      label: getFieldLabel(path),
      localValue: localVal,
      remoteValue: remoteVal,
      localLabel: formatDisplayValue(localVal),
      remoteLabel: formatDisplayValue(remoteVal),
    });
  }

  return { conflicts, autoMerged, mergedResult };
}

/** Set a value at a dotted path in a nested object, handling array keys like sources[key].field */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  // Parse path segments handling bracket notation
  const segments = parsePath(path);
  let current: unknown = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof current !== 'object' || current === null) return;

    if (seg.type === 'key') {
      current = (current as Record<string, unknown>)[seg.value];
    } else if (seg.type === 'arrayKey') {
      // Find item in array by natural key
      const arr = (current as Record<string, unknown>)[seg.arrayName];
      if (!Array.isArray(arr)) return;
      const parentPath = segments
        .slice(0, i)
        .map((s) => s.value)
        .join('.');
      const fullArrayPath = parentPath ? `${parentPath}.${seg.arrayName}` : seg.arrayName;
      const keyField = ARRAY_NATURAL_KEYS[fullArrayPath];
      if (!keyField) return;
      current = arr.find(
        (item: unknown) =>
          typeof item === 'object' && item !== null && (item as Record<string, unknown>)[keyField] === seg.value,
      );
    }
  }

  if (typeof current !== 'object' || current === null) return;

  const lastSeg = segments[segments.length - 1];
  if (lastSeg.type === 'key') {
    (current as Record<string, unknown>)[lastSeg.value] = value;
  }
}

interface PathSegment {
  type: 'key' | 'arrayKey';
  value: string;
  arrayName: string;
}

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  // Split on dots but respect brackets: project.sources[key].field
  const parts = path.split(/\.(?![^[]*\])/);

  for (const part of parts) {
    const bracketMatch = part.match(/^(.+?)\[(.+)\]$/);
    if (bracketMatch) {
      // e.g., "sources[data/search/pubmed.bib]"
      segments.push({ type: 'arrayKey', value: bracketMatch[2], arrayName: bracketMatch[1] });
    } else {
      segments.push({ type: 'key', value: part, arrayName: '' });
    }
  }

  return segments;
}

// --- Records.bib 3-way merge ---

interface BibRecord {
  id: string;
  content: string;
  title?: string;
  author?: string;
  year?: string;
  status?: string;
}

/** Split a BibTeX file into individual records by their entry ID. */
function splitBibRecords(content: string): Map<string, BibRecord> {
  const records = new Map<string, BibRecord>();
  // Match BibTeX entries: @type{id, ... }
  // Use a simple approach: split on @type{ patterns
  const entryRegex = /^@\w+\{([^,]+),/gm;
  const matches: { id: string; start: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(content)) !== null) {
    matches.push({ id: match[1].trim(), start: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : content.length;
    const recordContent = content.slice(start, end).trim();
    const id = matches[i].id;

    // Extract key fields for display labels
    const titleMatch = recordContent.match(/title\s*=\s*\{([^}]*)\}/);
    const authorMatch = recordContent.match(/author\s*=\s*\{([^}]*)\}/);
    const yearMatch = recordContent.match(/year\s*=\s*\{([^}]*)\}/);
    const statusMatch = recordContent.match(/colrev_status\s*=\s*\{([^}]*)\}/);

    records.set(id, {
      id,
      content: recordContent,
      title: titleMatch?.[1],
      author: authorMatch?.[1],
      year: yearMatch?.[1],
      status: statusMatch?.[1],
    });
  }

  return records;
}

/** Format a colrev_status value for display */
function formatStatus(status?: string): string {
  if (!status) return 'Unknown';
  return status
    .replace(/^(md_|rev_|pdf_)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a human-readable record label */
function recordLabel(record: BibRecord): string {
  const parts: string[] = [];
  if (record.author) {
    // Shorten to first author + et al.
    const firstAuthor = record.author.split(' and ')[0].trim();
    parts.push(firstAuthor);
  }
  if (record.year) parts.push(`(${record.year})`);
  return parts.join(' ') || record.id;
}

export function analyzeRecordsConflict(
  baseContent: string,
  localContent: string,
  remoteContent: string,
): { conflicts: ConflictItem[]; autoMerged: AutoMergedChange[]; mergedContent: string } {
  const baseRecords = splitBibRecords(baseContent);
  const localRecords = splitBibRecords(localContent);
  const remoteRecords = splitBibRecords(remoteContent);

  const conflicts: ConflictItem[] = [];
  const autoMerged: AutoMergedChange[] = [];

  // Merged records map
  const mergedRecords = new Map<string, string>();

  // Collect all record IDs
  const allIds = new Set<string>();
  for (const k of baseRecords.keys()) allIds.add(k);
  for (const k of localRecords.keys()) allIds.add(k);
  for (const k of remoteRecords.keys()) allIds.add(k);

  for (const id of allIds) {
    const base = baseRecords.get(id);
    const local = localRecords.get(id);
    const remote = remoteRecords.get(id);

    const inBase = base !== undefined;
    const inLocal = local !== undefined;
    const inRemote = remote !== undefined;

    if (inLocal && inRemote) {
      if (local!.content === remote!.content) {
        // Same content — no conflict
        mergedRecords.set(id, local!.content);
        continue;
      }

      if (!inBase) {
        // Both added the same ID with different content — conflict
        const label = recordLabel(local!);
        conflicts.push({
          id: `records:${id}`,
          file: 'data/records.bib',
          path: id,
          label,
          description: local!.title ? `"${local!.title}"` : undefined,
          localValue: local!.status,
          remoteValue: remote!.status,
          localLabel: formatStatus(local!.status),
          remoteLabel: formatStatus(remote!.status),
        });
        // Use local as placeholder in merged
        mergedRecords.set(id, local!.content);
        continue;
      }

      // In all three — check what changed
      const localChanged = local!.content !== base!.content;
      const remoteChanged = remote!.content !== base!.content;

      if (localChanged && !remoteChanged) {
        mergedRecords.set(id, local!.content);
        autoMerged.push({ label: `Record "${recordLabel(local!)}" updated`, source: 'local' });
      } else if (!localChanged && remoteChanged) {
        mergedRecords.set(id, remote!.content);
        autoMerged.push({ label: `Record "${recordLabel(remote!)}" updated`, source: 'remote' });
      } else if (localChanged && remoteChanged) {
        // Both changed — conflict
        const label = recordLabel(local!);
        conflicts.push({
          id: `records:${id}`,
          file: 'data/records.bib',
          path: id,
          label,
          description: local!.title ? `"${local!.title}"` : undefined,
          localValue: local!.status,
          remoteValue: remote!.status,
          localLabel: formatStatus(local!.status),
          remoteLabel: formatStatus(remote!.status),
        });
        mergedRecords.set(id, local!.content);
      } else {
        // Neither changed from base
        mergedRecords.set(id, local!.content);
      }
    } else if (inLocal && !inRemote) {
      if (inBase) {
        // Deleted in remote — auto-merge deletion
        autoMerged.push({ label: `Record "${recordLabel(local!)}" removed by collaborator`, source: 'remote' });
      } else {
        // Added only in local
        mergedRecords.set(id, local!.content);
        autoMerged.push({ label: `Record "${recordLabel(local!)}" added`, source: 'local' });
      }
    } else if (!inLocal && inRemote) {
      if (inBase) {
        // Deleted in local — auto-merge deletion
        autoMerged.push({ label: `Record "${recordLabel(remote!)}" removed by you`, source: 'local' });
      } else {
        // Added only in remote
        mergedRecords.set(id, remote!.content);
        autoMerged.push({ label: `Record "${recordLabel(remote!)}" added`, source: 'remote' });
      }
    }
    // Both deleted or only in base — skip
  }

  // Rebuild the BibTeX file preserving local order, then appending new remote records
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  // First: IDs in local order
  for (const id of localRecords.keys()) {
    if (mergedRecords.has(id)) {
      orderedIds.push(id);
      seen.add(id);
    }
  }
  // Then: IDs only from remote (new additions)
  for (const id of remoteRecords.keys()) {
    if (!seen.has(id) && mergedRecords.has(id)) {
      orderedIds.push(id);
    }
  }

  const mergedContent = orderedIds.map((id) => mergedRecords.get(id)!).join('\n\n') + '\n';

  return { conflicts, autoMerged, mergedContent };
}

// --- File-level fallback ---

export function analyzeFileConflict(
  filePath: string,
  baseContent: string | null,
  localContent: string,
  remoteContent: string,
): { conflict: ConflictItem | null; autoMerged: AutoMergedChange | null } {
  if (localContent === remoteContent) {
    return { conflict: null, autoMerged: null };
  }

  const localChanged = baseContent === null || localContent !== baseContent;
  const remoteChanged = baseContent === null || remoteContent !== baseContent;

  if (localChanged && !remoteChanged) {
    return { conflict: null, autoMerged: { label: filePath, source: 'local' } };
  }

  if (!localChanged && remoteChanged) {
    return { conflict: null, autoMerged: { label: filePath, source: 'remote' } };
  }

  // Both changed to different content
  const localLines = localContent.split('\n').length;
  const remoteLines = remoteContent.split('\n').length;

  return {
    conflict: {
      id: `file:${filePath}`,
      file: filePath,
      path: filePath,
      label: filePath.split('/').pop() || filePath,
      description: `Your version: ${localLines} lines, Their version: ${remoteLines} lines`,
      localValue: localContent,
      remoteValue: remoteContent,
      localLabel: `${localLines} lines`,
      remoteLabel: `${remoteLines} lines`,
    },
    autoMerged: null,
  };
}

// --- Display value formatting ---

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value || '(empty)';
  if (typeof value === 'number') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty list)';
    if (typeof value[0] === 'string') return value.join(', ');
    if (typeof value[0] === 'object') return `${value.length} item(s)`;
    return JSON.stringify(value);
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 3) {
      return entries.map(([k, v]) => `${k}: ${formatDisplayValue(v)}`).join(', ');
    }
    return `${entries.length} fields`;
  }

  return String(value);
}

// --- Main orchestrator ---

export interface AnalyzeDivergenceParams {
  projectPath: string;
  baseHash: string;
  localChangedFiles: string[];
  remoteChangedFiles: string[];
  getFileContent: (ref: string, filePath: string) => Promise<string | null>;
}

export async function analyzeDivergence(params: AnalyzeDivergenceParams): Promise<MergeAnalysis> {
  const { baseHash, localChangedFiles, remoteChangedFiles, getFileContent } = params;

  const conflicts: ConflictItem[] = [];
  const autoMerged: AutoMergedChange[] = [];
  const fileResults: Record<string, FileResolution> = {};

  // Files changed only in one side — auto-merge
  const localOnly = localChangedFiles.filter((f) => !remoteChangedFiles.includes(f));
  const remoteOnly = remoteChangedFiles.filter((f) => !localChangedFiles.includes(f));
  const bothChanged = localChangedFiles.filter((f) => remoteChangedFiles.includes(f));

  for (const f of localOnly) {
    autoMerged.push({ label: f.split('/').pop() || f, source: 'local' });
  }
  for (const f of remoteOnly) {
    autoMerged.push({ label: f.split('/').pop() || f, source: 'remote' });
  }

  // Analyze files changed in both sides
  for (const filePath of bothChanged) {
    const [baseContent, localContent, remoteContent] = await Promise.all([
      getFileContent(baseHash, filePath),
      getFileContent('HEAD', filePath),
      getFileContent('origin/dev', filePath),
    ]);

    // If we can't read the file, skip with file-level fallback
    if (localContent === null || remoteContent === null) {
      conflicts.push({
        id: `file:${filePath}`,
        file: filePath,
        path: filePath,
        label: filePath.split('/').pop() || filePath,
        description: 'Could not read file contents for comparison',
        localValue: '(your version)',
        remoteValue: '(their version)',
        localLabel: 'Your version',
        remoteLabel: "Collaborator's version",
      });
      fileResults[filePath] = { content: '', needsResolution: true };
      continue;
    }

    if (filePath === 'settings.json') {
      try {
        const baseJson = baseContent ? JSON.parse(baseContent) : {};
        const localJson = JSON.parse(localContent);
        const remoteJson = JSON.parse(remoteContent);

        const result = analyzeSettingsConflict(baseJson, localJson, remoteJson);
        conflicts.push(...result.conflicts);
        autoMerged.push(...result.autoMerged);
        fileResults[filePath] = {
          content: JSON.stringify(result.mergedResult, null, 4),
          needsResolution: result.conflicts.length > 0,
        };
      } catch {
        // JSON parse failed — fall back to file-level
        const result = analyzeFileConflict(filePath, baseContent, localContent, remoteContent);
        if (result.conflict) conflicts.push(result.conflict);
        if (result.autoMerged) autoMerged.push(result.autoMerged);
        fileResults[filePath] = { content: localContent, needsResolution: !!result.conflict };
      }
    } else if (filePath === 'data/records.bib') {
      const result = analyzeRecordsConflict(baseContent || '', localContent, remoteContent);
      conflicts.push(...result.conflicts);
      autoMerged.push(...result.autoMerged);
      fileResults[filePath] = {
        content: result.mergedContent,
        needsResolution: result.conflicts.length > 0,
      };
    } else {
      // Generic file-level comparison
      const result = analyzeFileConflict(filePath, baseContent, localContent, remoteContent);
      if (result.conflict) {
        conflicts.push(result.conflict);
        fileResults[filePath] = { content: localContent, needsResolution: true };
      } else if (result.autoMerged) {
        autoMerged.push(result.autoMerged);
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    autoMerged,
    fileResults,
  };
}

/**
 * Apply user's conflict resolutions to produce final file contents.
 * Returns a map of filePath → resolved content ready to write.
 */
export function applyResolutions(
  analysis: MergeAnalysis,
  resolutions: ConflictResolution[],
  localFiles: Record<string, string>,
  remoteFiles: Record<string, string>,
): Record<string, string> {
  const resolutionMap = new Map(resolutions.map((r) => [r.id, r.choice]));
  const result: Record<string, string> = {};

  // Group conflicts by file
  const conflictsByFile = new Map<string, ConflictItem[]>();
  for (const conflict of analysis.conflicts) {
    const existing = conflictsByFile.get(conflict.file) || [];
    existing.push(conflict);
    conflictsByFile.set(conflict.file, existing);
  }

  // Process each file that needs resolution
  for (const [filePath, fileRes] of Object.entries(analysis.fileResults)) {
    if (!fileRes.needsResolution) {
      // Auto-merged — use the pre-computed content
      result[filePath] = fileRes.content;
      continue;
    }

    const fileConflicts = conflictsByFile.get(filePath) || [];

    if (filePath === 'settings.json') {
      // Apply field-level resolutions to the merged JSON
      const mergedJson = JSON.parse(fileRes.content);
      for (const conflict of fileConflicts) {
        const choice = resolutionMap.get(conflict.id) || 'local';
        const value = choice === 'local' ? conflict.localValue : conflict.remoteValue;
        setNestedValue(mergedJson, conflict.path, value);
      }
      result[filePath] = JSON.stringify(mergedJson, null, 4) + '\n';
    } else if (filePath === 'data/records.bib') {
      // Apply record-level resolutions
      let mergedContent = fileRes.content;
      for (const conflict of fileConflicts) {
        const choice = resolutionMap.get(conflict.id) || 'local';
        if (choice === 'remote') {
          // Replace the local record block with the remote one
          const remoteRecords = splitBibRecords(remoteFiles[filePath] || '');
          const remoteRecord = remoteRecords.get(conflict.path);
          const localRecords = splitBibRecords(mergedContent);
          const localRecord = localRecords.get(conflict.path);
          if (remoteRecord && localRecord) {
            mergedContent = mergedContent.replace(localRecord.content, remoteRecord.content);
          }
        }
        // 'local' choice: already using local content
      }
      result[filePath] = mergedContent;
    } else {
      // File-level resolution
      const conflict = fileConflicts[0];
      if (conflict) {
        const choice = resolutionMap.get(conflict.id) || 'local';
        result[filePath] = choice === 'local'
          ? (localFiles[filePath] || fileRes.content)
          : (remoteFiles[filePath] || fileRes.content);
      }
    }
  }

  return result;
}
