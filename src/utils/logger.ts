import { env } from "./env.js";

export enum LogLevel {
	DEBUG,
	INFO,
	ERROR,
}

const parseLogLevel = (level: string): LogLevel => {
	if (level in LogLevel) {
		return LogLevel[level as keyof typeof LogLevel];
	}
	throw new Error(`Invalid log level: ${level}`);
};

class Logger {
	private static instance: Logger;
	private logLevel: LogLevel;

	private constructor(logLevel: LogLevel) {
		this.logLevel = logLevel;
	}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			const logLevel = parseLogLevel(env.LOG_LEVEL);
			Logger.instance = new Logger(logLevel);
		}
		return Logger.instance;
	}

	public shouldLog(level: LogLevel): boolean {
		return this.logLevel <= level;
	}

	public debug(...messages: unknown[]): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.debug("[DEBUG]", ...messages);
		}
	}

	public info(...messages: unknown[]): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.info("[INFO]", ...messages);
		}
	}

	public error(...messages: unknown[]): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error("[ERROR]", ...messages);
		}
	}
}

const logger = Logger.getInstance();

export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const error = logger.error.bind(logger);
export const shouldLog = logger.shouldLog.bind(logger);
