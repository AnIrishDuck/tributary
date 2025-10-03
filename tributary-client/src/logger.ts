import { Logger, ILogObj } from "tslog";

// Create a base logger configuration
const loggerConfig = {
  name: "tributary-client",
  type: "pretty" as const,
  minLevel: process.env.TRIBUTARY_LOG_LEVEL ? 
    parseInt(process.env.TRIBUTARY_LOG_LEVEL) : 3, // Default to INFO level
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
};

// Create the logger instance
export const logger = new Logger<ILogObj>(loggerConfig);

// Export different log levels for convenience
export const silly = logger.silly.bind(logger);
export const trace = logger.trace.bind(logger);
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const fatal = logger.fatal.bind(logger);
