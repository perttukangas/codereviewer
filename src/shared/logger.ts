import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

const parseLogLevel = (level: string): LogLevel => {
	if (level in LogLevel) {
		return LogLevel[level as keyof typeof LogLevel];
	}
	throw new Error(`Invalid log level: ${level}`);
};

const formatMessage = (level: LogLevel, messages: unknown[]): string => {
	const text = messages
		.map((message) =>
			typeof message === "string" ? message : inspect(message, { depth: null }),
		)
		.join(" ");
	return `[${new Date().toISOString()}] [${levelNames[level]}] ${text}`;
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

	private writeToFile(line: string): void {
		if (!env.LOG_FILE || this.fileLoggingFailed) {
			return;
		}

		try {
			const directory = dirname(env.LOG_FILE);
			if (directory && directory !== ".") {
				mkdirSync(directory, { recursive: true });
			}
			appendFileSync(env.LOG_FILE, `${line}\n`);
		} catch (cause) {
			this.fileLoggingFailed = true;
			console.error(
				`[${new Date().toISOString()}] [ERROR] Failed to write log file ${env.LOG_FILE}`,
				cause,
			);
		}
	}

	private emit(
		level: LogLevel,
		write: (...messages: unknown[]) => void,
		messages: unknown[],
	): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const line = formatMessage(level, messages);
		write(line);
		this.writeToFile(line);
	}

	public debug(...messages: unknown[]): void {
		this.emit(LogLevel.DEBUG, console.debug, messages);
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
		this.emit(LogLevel.INFO, console.info, messages);
	}

	public error(...messages: unknown[]): void {
		this.emit(LogLevel.ERROR, console.error, messages);
	}
}

const logger = Logger.getInstance();

export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const error = logger.error.bind(logger);
export const shouldLog = logger.shouldLog.bind(logger);
export const startTimer = logger.startTimer.bind(logger);
export const stopTimer = logger.stopTimer.bind(logger);
