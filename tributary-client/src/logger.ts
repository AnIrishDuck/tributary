import { Logger, ILogObj } from "tslog";

/**
 * Create a named tslog Logger with the shared Tributary configuration.
 *
 * The log level defaults to INFO (3) and can be overridden via the
 * `TRIBUTARY_LOG_LEVEL` environment variable.
 */
export function createLogger(name: string): Logger<ILogObj> {
  return new Logger<ILogObj>({
    name,
    type: "pretty" as const,
    minLevel: process.env.TRIBUTARY_LOG_LEVEL
      ? parseInt(process.env.TRIBUTARY_LOG_LEVEL, 10)
      : 3,
    prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{fileNameWithLine}}]\t",
    prettyLogStyles: {
      logLevelName: {
        "*": ["bold", "black", "dim"],
        SILLY: ["white"],
        TRACE: ["whiteBright"],
        DEBUG: ["green"],
        INFO: ["blue"],
        WARN: ["yellow", "bold"],
        ERROR: ["red", "bold"],
        FATAL: ["redBright", "bold"],
      },
      dateIsoStr: "white",
      fileNameWithLine: "white",
      name: ["white", "bold"],
    },
    hideLogPositionForProduction: false,
  });
}

// Create the logger instance
export const logger = createLogger("tributary-client");

// Export different log levels for convenience
export const silly = logger.silly.bind(logger);
export const trace = logger.trace.bind(logger);
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const fatal = logger.fatal.bind(logger);
