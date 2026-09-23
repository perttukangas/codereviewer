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
	private readonly timers = new Map<string, number>();

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
			console.debug(`[${new Date().toISOString()}] [DEBUG]`, ...messages);
		}
	}

	public startTimer(id: string, message: string): void {
		this.timers.set(id, Date.now());
		this.info(message, id);
	}

	public stopTimer(id: string, message: string): void {
		const startMillis = this.timers.get(id);
		if (startMillis === undefined) {
			return;
		}

		this.timers.delete(id);
		this.info(message, id, `${Date.now() - startMillis} ms`);
	}

	public info(...messages: unknown[]): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.info(`[${new Date().toISOString()}] [INFO]`, ...messages);
		}
	}

	public error(...messages: unknown[]): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(`[${new Date().toISOString()}] [ERROR]`, ...messages);
		}
	}
}

const logger = Logger.getInstance();

export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const error = logger.error.bind(logger);
export const shouldLog = logger.shouldLog.bind(logger);
export const startTimer = logger.startTimer.bind(logger);
export const stopTimer = logger.stopTimer.bind(logger);
