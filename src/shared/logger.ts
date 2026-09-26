import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import { env } from "./env.js";

export enum LogLevel {
	DEBUG,
	INFO,
	ERROR,
}

const levelNames: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: "DEBUG",
	[LogLevel.INFO]: "INFO",
	[LogLevel.ERROR]: "ERROR",
};

export type LogContext = {
	agentId?: string;
};

export interface ScopedLogger {
	debug(...messages: unknown[]): void;
	info(...messages: unknown[]): void;
	error(...messages: unknown[]): void;
	startTimer(id: string, message: string): void;
	stopTimer(id: string, message: string): void;
}

const parseLogLevel = (level: string): LogLevel => {
	if (level in LogLevel) {
		return LogLevel[level as keyof typeof LogLevel];
	}
	throw new Error(`Invalid log level: ${level}`);
};

const sanitizeAgentId = (agentId: string): string =>
	agentId.replace(/[^a-zA-Z0-9._-]/g, "-");

const formatMessage = (
	level: LogLevel,
	context: LogContext,
	messages: unknown[],
): string => {
	const text = messages
		.map((message) =>
			typeof message === "string" ? message : inspect(message, { depth: null }),
		)
		.join(" ");
	const tag = context.agentId ? ` [${context.agentId}]` : "";
	return `[${new Date().toISOString()}] [${levelNames[level]}]${tag} ${text}`;
};

class Logger {
	private static instance: Logger;
	private logLevel: LogLevel;
	private readonly timers = new Map<string, number>();
	private fileLoggingFailed = false;

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

	private writeToFile(path: string, line: string): void {
		try {
			appendFileSync(path, `${line}\n`);
		} catch (cause) {
			this.fileLoggingFailed = true;
			console.error(
				`[${new Date().toISOString()}] [ERROR] Failed to write log file ${path}`,
				cause,
			);
		}
	}

	private writeLine(line: string, context: LogContext): void {
		if (!env.LOG_DIR || this.fileLoggingFailed) {
			return;
		}

		try {
			mkdirSync(env.LOG_DIR, { recursive: true });
		} catch (cause) {
			this.fileLoggingFailed = true;
			console.error(
				`[${new Date().toISOString()}] [ERROR] Failed to create log directory ${env.LOG_DIR}`,
				cause,
			);
			return;
		}

		this.writeToFile(join(env.LOG_DIR, "combined.log"), line);

		if (context.agentId) {
			this.writeToFile(
				join(env.LOG_DIR, `${sanitizeAgentId(context.agentId)}.log`),
				line,
			);
		}
	}

	private emit(
		level: LogLevel,
		context: LogContext,
		write: (...messages: unknown[]) => void,
		messages: unknown[],
	): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const line = formatMessage(level, context, messages);
		write(line);
		this.writeLine(line, context);
	}

	public debug(context: LogContext, ...messages: unknown[]): void {
		this.emit(LogLevel.DEBUG, context, console.debug, messages);
	}

	public startTimer(context: LogContext, id: string, message: string): void {
		this.timers.set(id, Date.now());
		this.info(context, message, id);
	}

	public stopTimer(context: LogContext, id: string, message: string): void {
		const startMillis = this.timers.get(id);
		if (startMillis === undefined) {
			return;
		}

		this.timers.delete(id);
		this.info(context, message, id, `${Date.now() - startMillis} ms`);
	}

	public info(context: LogContext, ...messages: unknown[]): void {
		this.emit(LogLevel.INFO, context, console.info, messages);
	}

	public error(context: LogContext, ...messages: unknown[]): void {
		this.emit(LogLevel.ERROR, context, console.error, messages);
	}
}

const logger = Logger.getInstance();

export const createLogger = (context: LogContext = {}): ScopedLogger => ({
	debug: (...messages) => logger.debug(context, ...messages),
	info: (...messages) => logger.info(context, ...messages),
	error: (...messages) => logger.error(context, ...messages),
	startTimer: (id, message) => logger.startTimer(context, id, message),
	stopTimer: (id, message) => logger.stopTimer(context, id, message),
});

const rootLogger = createLogger();

export const debug = rootLogger.debug;
export const info = rootLogger.info;
export const error = rootLogger.error;
export const shouldLog = logger.shouldLog.bind(logger);
export const startTimer = rootLogger.startTimer;
export const stopTimer = rootLogger.stopTimer;
