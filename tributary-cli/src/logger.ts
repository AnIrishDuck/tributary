import { createLogger } from 'tributary-client';

const { logger, silly, trace, debug, info, warn, error, fatal } = createLogger("tributary-cli");
export { logger, silly, trace, debug, info, warn, error, fatal };
