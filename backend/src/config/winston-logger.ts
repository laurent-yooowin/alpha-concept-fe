import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { WinstonModule } from 'nest-winston';
import * as path from 'path';
import * as fs from 'fs';

const ensureWritableLogDir = (dir: string) => {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return dir;
};

const resolveLogDir = () => {
    const candidates = [
        process.env.LOG_DIR,
        path.join(__dirname, '../../logs'),
        '/tmp/reportbtp-logs',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        try {
            return ensureWritableLogDir(candidate);
        } catch (error: any) {
            // Keep bootstrap alive even if a mounted logs folder has wrong owner.
            console.warn(`Logger cannot write to ${candidate}: ${error?.message || error}`);
        }
    }

    return null;
};

const logDir = resolveLogDir();

// ANSI colors for the console
const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    gray: '\x1b[90m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
};

const LEVEL_BADGE: Record<string, string> = {
    error: `${COLORS.bgRed}${COLORS.white}${COLORS.bold} ERROR ${COLORS.reset}`,
    warn:  `${COLORS.bgYellow}${COLORS.white}${COLORS.bold}  WARN ${COLORS.reset}`,
    info:  `${COLORS.bgBlue}${COLORS.white}${COLORS.bold}  INFO ${COLORS.reset}`,
    debug: `${COLORS.bgMagenta}${COLORS.white}${COLORS.bold} DEBUG ${COLORS.reset}`,
    verbose: `${COLORS.bgCyan}${COLORS.white}${COLORS.bold}  VERB ${COLORS.reset}`,
    log:   `${COLORS.bgBlue}${COLORS.white}${COLORS.bold}  INFO ${COLORS.reset}`,
};

const METHOD_COLOR: Record<string, string> = {
    GET: COLORS.green,
    POST: COLORS.cyan,
    PUT: COLORS.yellow,
    PATCH: COLORS.magenta,
    DELETE: COLORS.red,
    OPTIONS: COLORS.gray,
    HEAD: COLORS.gray,
};

function statusColor(status: number) {
    if (status >= 500) return `${COLORS.bgRed}${COLORS.white}${COLORS.bold} ${status} ${COLORS.reset}`;
    if (status >= 400) return `${COLORS.bgYellow}${COLORS.white}${COLORS.bold} ${status} ${COLORS.reset}`;
    if (status >= 300) return `${COLORS.cyan}${COLORS.bold}${status}${COLORS.reset}`;
    if (status >= 200) return `${COLORS.green}${COLORS.bold}${status}${COLORS.reset}`;
    return `${COLORS.gray}${status}${COLORS.reset}`;
}

function durationColor(ms: number) {
    if (ms >= 1000) return `${COLORS.red}${ms}ms${COLORS.reset}`;
    if (ms >= 500) return `${COLORS.yellow}${ms}ms${COLORS.reset}`;
    return `${COLORS.gray}${ms}ms${COLORS.reset}`;
}

// ── Console format: stylish, human-readable ──────────────────────────────
const consoleFormat = winston.format.printf((info) => {
    const { timestamp, level, message, context, requestId, http, stack, ms } = info as any;
    const lvl = LEVEL_BADGE[level] || LEVEL_BADGE.info;
    const ts = `${COLORS.gray}${timestamp}${COLORS.reset}`;
    const ctx = context ? `${COLORS.magenta}[${context}]${COLORS.reset} ` : '';
    const rid = requestId ? `${COLORS.dim}(${String(requestId).slice(0, 8)})${COLORS.reset} ` : '';

    if (http) {
        const m = http.method as string;
        const mc = METHOD_COLOR[m] || COLORS.white;
        const method = `${mc}${COLORS.bold}${m.padEnd(6)}${COLORS.reset}`;
        const url = `${COLORS.white}${http.url}${COLORS.reset}`;
        const status = http.statusCode != null ? statusColor(http.statusCode) : '';
        const dur = http.durationMs != null ? durationColor(http.durationMs) : '';
        const ip = http.ip ? `${COLORS.dim}${http.ip}${COLORS.reset}` : '';
        const user = http.userId ? ` ${COLORS.dim}user=${http.userId}${COLORS.reset}` : '';
        return `${ts} ${lvl} ${ctx}${rid}${method} ${url} ${status} ${dur} ${ip}${user}`;
    }

    let out = `${ts} ${lvl} ${ctx}${rid}${message}`;
    if (typeof ms === 'number') out += ` ${durationColor(ms)}`;
    if (stack) out += `\n${COLORS.red}${stack}${COLORS.reset}`;
    return out;
});

// ── File format: structured JSON for easy parsing ────────────────────────
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
);

const baseFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
);

// ── Transports ───────────────────────────────────────────────────────────
const appTransport = logDir ? new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    level: 'info',
    format: fileFormat,
}) : null;

const errorTransport = logDir ? new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: fileFormat,
}) : null;

const httpTransport = logDir ? new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'http-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    level: 'info',
    format: winston.format.combine(
        winston.format((info) => (info.http ? info : false))(),
        fileFormat,
    ),
}) : null;

const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(baseFormat, consoleFormat),
});

const transports = [
    consoleTransport,
    ...(appTransport ? [appTransport] : []),
    ...(errorTransport ? [errorTransport] : []),
    ...(httpTransport ? [httpTransport] : []),
];

export const winstonLogger = WinstonModule.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: baseFormat,
    transports,
});
