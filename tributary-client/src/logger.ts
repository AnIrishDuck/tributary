import { Logger, ILogObj } from "tslog";

/** Create a named logger with the shared Tributary configuration. */
export function createLogger(name: string) {
  const logger = new Logger<ILogObj>({
    name,
    type: "pretty" as const,
    minLevel: process.env.TRIBUTARY_LOG_LEVEL ?
      parseInt(process.env.TRIBUTARY_LOG_LEVEL) : 3, // Default to INFO level
    prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{filePathWithLine}}]\t",
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
      filePathWithLine: "white",
      name: ["white", "bold"],
    },
    hideLogPositionForProduction: false,
  });

  return {
    logger,
    silly: logger.silly.bind(logger),
    trace: logger.trace.bind(logger),
    debug: logger.debug.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    fatal: logger.fatal.bind(logger),
  };
}

// Default logger instance for tributary-client
const defaultLogger = createLogger("tributary-client");
export const logger = defaultLogger.logger;
export const silly = defaultLogger.silly;
export const trace = defaultLogger.trace;
export const debug = defaultLogger.debug;
export const info = defaultLogger.info;
export const warn = defaultLogger.warn;
export const error = defaultLogger.error;
export const fatal = defaultLogger.fatal;
