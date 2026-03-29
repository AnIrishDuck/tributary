import { createLogger } from "tributary-client";

// Create the logger instance
export const logger = createLogger("tributary-cli");

// Export different log levels for convenience
export const silly = logger.silly.bind(logger);
export const trace = logger.trace.bind(logger);
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const fatal = logger.fatal.bind(logger);
