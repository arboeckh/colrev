/** The last segment of a path, whichever separator it uses. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || '';
}

/** A file's bytes as base64, exactly as on disk (no text decoding). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // "data:<mime>;base64,<payload>" — an empty file has no comma-separated payload.
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * A file name for an uploaded search file that no existing source uses.
 *
 * Sources are keyed by the file's stem (`<stem>_search_history.json`), so two
 * uploads for one connector must not share it: the second would overwrite the
 * first file and add a duplicate source.
 */
export function uniqueSearchFilename(
  connectorId: string,
  originalName: string,
  existingPaths: readonly string[],
): string {
  const dot = originalName.lastIndexOf('.');
  const ext = (dot > 0 ? originalName.slice(dot + 1) : 'bib').toLowerCase();
  const clean = (text: string) => text.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const origStem = clean(dot > 0 ? originalName.slice(0, dot) : originalName);
  const base = [clean(connectorId), origStem].filter(Boolean).join('_') || 'upload';

  const taken = new Set(
    existingPaths.map((p) => baseName(p).replace(/\.[^.]+$/, '').toLowerCase()),
  );
  let stem = base;
  for (let n = 2; taken.has(stem); n++) stem = `${base}_${n}`;
  return `${stem}.${ext}`;
}
