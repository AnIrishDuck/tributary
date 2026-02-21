import fs from 'fs';
import path from 'path';

/**
 * Read the stored library public key from a sync directory's .scribe/library-pk file.
 */
export function readStoredLibraryPk(directory: string): string | null {
  const pkFile = path.join(directory, '.scribe', 'library-pk');
  try {
    return fs.readFileSync(pkFile, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Write the library public key to a sync directory's .scribe/library-pk file.
 */
export async function writeStoredLibraryPk(directory: string, pk: string): Promise<void> {
  const scribeDir = path.join(directory, '.scribe');
  await fs.promises.mkdir(scribeDir, { recursive: true });
  await fs.promises.writeFile(path.join(scribeDir, 'library-pk'), pk + '\n', 'utf8');
}

/**
 * Resolve the library public key from an explicit option or the stored .scribe/library-pk file.
 * Throws if neither is available.
 */
export function resolveLibraryPk(directory: string, optionPk?: string): string {
  if (optionPk) {
    return optionPk;
  }
  const stored = readStoredLibraryPk(directory);
  if (stored) {
    return stored;
  }
  throw new Error(
    'No library specified. Use --library-pk <public-key> or run `scribe library list` to see available libraries.'
  );
}
