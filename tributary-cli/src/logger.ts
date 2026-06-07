import { createLogger } from 'tributary-client';

const { logger, silly, trace, debug, info, warn, error, fatal } = createLogger("tributary-cli");
export { logger, silly, trace, debug, info, warn, error, fatal };

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  return String(err);
}
