import type { SyncItem, SyncOperation } from '@tributary/scribe-data';

/**
 * Determine the source of truth (where the change originates) for a sync operation.
 *
 * - Create: the item exists on the opposite side of target.source
 * - Update: target is the authoritative (newer) version
 * - Move: from.source indicates which side moved
 */
function getChangeSource(op: SyncOperation): 'local' | 'remote' {
  if (op.kind === 'create') {
    return op.target.source === 'local' ? 'remote' : 'local';
  } else if (op.kind === 'update') {
    return op.target.source;
  } else {
    return op.from.source;
  }
}

/**
 * Format a slug path with the appropriate prefix based on source.
 *
 * - Local items: just the path, e.g. '/cooking/pasta'
 * - Remote items: pk prefix + path, e.g. '1abfu259:/cooking/pasta'
 */
function formatItemPath(itemPath: string, source: 'local' | 'remote', pkPrefix: string): string {
  if (source === 'remote') {
    return `${pkPrefix}:${itemPath}`;
  }
  return itemPath;
}

/**
 * Format sync operations as a diff stat summary.
 *
 * Each line shows what would happen during a sync:
 * - `+  /path`         — create a new item
 * - `+- /path`         — update an existing item
 * - `*  /from => /to`  — move an item
 *
 * Local items use the local path. Remote items are prefixed
 * with the first 8 characters of the library public key.
 *
 * @param operations The list of sync operations
 * @param pkPrefix The 8-character library public key prefix for remote items
 * @returns Array of formatted lines
 */
export function formatDiffStat(operations: SyncOperation[], pkPrefix: string): string[] {
  const lines: string[] = [];

  for (const op of operations) {
    const source = getChangeSource(op);

    switch (op.kind) {
      case 'create': {
        const display = formatItemPath(op.target.path, source, pkPrefix);
        lines.push(`+  ${display}`);
        break;
      }
      case 'update': {
        const display = formatItemPath(op.target.path, source, pkPrefix);
        lines.push(`+- ${display}`);
        break;
      }
      case 'move': {
        const fromDisplay = formatItemPath(op.from.path, source, pkPrefix);
        const toDisplay = formatItemPath(op.to.path, source, pkPrefix);
        lines.push(`*  ${fromDisplay} => ${toDisplay}`);
        break;
      }
    }
  }

  return lines;
}
