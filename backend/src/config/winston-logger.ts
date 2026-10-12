import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { WinstonModule } from 'nest-winston';
import * as path from 'path';
import * as fs from 'fs';
import { hostname } from 'os';
import { sanitizePersistentLog } from './persistent-log-sanitizer';

const ensureWritableLogDir = (dir: string) => {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return dir;
};

const resolveLogDir = () => {
    // Never silently fall back to an ephemeral directory or console-only mode.
    return ensureWritableLogDir(process.env.LOG_DIR || path.join(__dirname, '../../logs'));
};

const logDir = resolveLogDir();
const logInstance = `${hostname().replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32) || 'host'}-${process.pid}`;
let retentionStarted = false;
const heartbeatStarted = new Set<string>();

function startLogHeartbeat(service: BackendLogService): void {
    if (!logDir || heartbeatStarted.has(service)) return;
    const marker = path.join(logDir, `.active-${service}-${logInstance}.heartbeat`);
    const touch = () => {
        const fd = fs.openSync(marker, 'a', 0o600);
        fs.closeSync(fd);
        fs.chmodSync(marker, 0o600);
        const now = new Date();
        fs.utimesSync(marker, now, now);
    };
    // A configured volume that cannot track active writers must fail startup.
    touch();
    heartbeatStarted.add(service);
    setInterval(() => {
        try { touch(); } catch (error: any) {
            console.warn(`Log heartbeat failed: ${error?.code || 'UNKNOWN'}`);
        }
    }, 60_000).unref();
}

export function pruneLogDirectory(directory: string, now = Date.now(), quotaBytes = 512 * 1024 * 1024): void {
        let totalBytes = 0;
        type LogFile = { filename: string; mtimeMs: number; size: number; channel: string; family: string | null; order: string; auditInstance?: string };
        const files: LogFile[] = [];
        const activeByFamily = new Map<string, LogFile>();
        const activeInstances = new Set<string>();
        let failures = 0;
        try {
            const names = fs.readdirSync(directory);
            for (const name of names) {
                if (!/^\.active-(?:api|prevention-worker)-[a-zA-Z0-9-]+\.heartbeat$/.test(name)) continue;
                try {
                    const filename = path.join(directory, name);
                    const stat = fs.lstatSync(filename);
                    if (!stat.isFile()) continue;
                    if (stat.mode & 0o077) fs.chmodSync(filename, 0o600);
                    if (now - stat.mtimeMs < 180_000) activeInstances.add(name.slice(8, -10));
                    else if (now - stat.mtimeMs > 86_400_000) fs.unlinkSync(filename);
                } catch { failures += 1; }
            }
            for (const name of names) {
                try {
                    const match = name.match(/^((?:api|prevention-worker)-[a-zA-Z0-9-]+-(app|error|http|stdio))-(\d{4}-\d{2}-\d{2})(?:\.log(?:\.(\d+))?|\.(\d+)\.log)$/);
                    const legacy = /^(?:app|error|http)-\d{4}-\d{2}-\d{2}\.log(?:\.gz)?$/.test(name);
                    const audit = name.match(/^\.audit-((?:api|prevention-worker)-[a-zA-Z0-9-]+)-(app|error|http)\.json$/);
                    const legacyAudit = /^\.[0-9a-f]{40,64}-audit\.json$/.test(name);
                    if (!match && !legacy && !audit && !legacyAudit) continue;
                    const filename = path.join(directory, name);
                    const stat = fs.lstatSync(filename);
                    if (!stat.isFile()) continue;
                    // Legacy archives may have been created without the stream mode.
                    if (stat.mode & 0o077) fs.chmodSync(filename, 0o600);
                    const file: LogFile = {
                        filename, mtimeMs: stat.mtimeMs, size: stat.size,
                        channel: match?.[2] ?? audit?.[2] ?? name.split('-', 1)[0],
                        family: match?.[1] ?? null,
                        order: match ? `${match[3]}-${String(Number(match[4] ?? match[5] ?? 0)).padStart(8, '0')}` : '',
                        auditInstance: audit?.[1],
                    };
                    files.push(file);
                    if (file.family) {
                        const current = activeByFamily.get(file.family);
                        if (!current || file.order > current.order) activeByFamily.set(file.family, file);
                    }
                } catch { failures += 1; }
            }
            const quotaCandidates: LogFile[] = [];
            for (const file of files) {
                // Protect the newest segment per process/transport even across
                // midnight: it may still be open until the next write.
                const instance = file.family?.replace(/-(?:app|error|http|stdio)$/, '');
                const active = (!!instance && activeInstances.has(instance) && activeByFamily.get(file.family!)?.filename === file.filename) ||
                    (!!file.auditInstance && activeInstances.has(file.auditInstance));
                // Old shared-name writers cannot be identified; leave today's
                // legacy files untouched during a rolling deployment.
                const legacyRecent = !file.family && !file.auditInstance && now - file.mtimeMs < 86_400_000;
                if (!active && !legacyRecent && now - file.mtimeMs > (file.channel === 'error' ? 30 : 14) * 86_400_000) {
                    try { fs.unlinkSync(file.filename); continue; } catch { failures += 1; }
                }
                totalBytes += file.size;
                // Let rotation finish before unlinking a closed segment.
                if (!active && !legacyRecent && now - file.mtimeMs > 120_000) quotaCandidates.push(file);
            }
            if (totalBytes > quotaBytes) {
                quotaCandidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
                for (const candidate of quotaCandidates) {
                    if (totalBytes <= quotaBytes) break;
                    try {
                        fs.unlinkSync(candidate.filename);
                        totalBytes -= candidate.size;
                    } catch { failures += 1; }
                }
            }
        } catch (error: any) {
            console.warn(`Log retention scan failed: ${error?.code || 'UNKNOWN'}`);
        }
        if (failures) console.warn(`Log retention could not secure ${failures} file(s)`);
}

function startLogRetention(): void {
    if (retentionStarted) return;
    retentionStarted = true;
    pruneLogDirectory(logDir);
    setInterval(() => pruneLogDirectory(logDir), 300_000).unref();
}

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
    const { timestamp, level, message, context, requestId, http, stack, ms, error } = info as any;
    const lvl = LEVEL_BADGE[level] || LEVEL_BADGE.info;
    const ts = `${COLORS.gray}${timestamp}${COLORS.reset}`;
    const ctx = context ? `${COLORS.magenta}[${context}]${COLORS.reset} ` : '';
    const rid = requestId ? `${COLORS.dim}(${String(requestId).slice(0, 8)})${COLORS.reset} ` : '';

    if (http) {
        const m = typeof http.method === 'string' ? http.method : 'HTTP';
        const mc = METHOD_COLOR[m] || COLORS.white;
        const method = `${mc}${COLORS.bold}${m.padEnd(6)}${COLORS.reset}`;
        const url = `${COLORS.white}${http.pathFingerprint ? `path#${http.pathFingerprint}` : '-'}${COLORS.reset}`;
        const status = http.statusCode != null ? statusColor(http.statusCode) : '';
        const dur = http.durationMs != null ? durationColor(http.durationMs) : '';
        const ip = http.ip ? `${COLORS.dim}${http.ip}${COLORS.reset}` : '';
        const user = http.userId ? ` ${COLORS.dim}user=${http.userId}${COLORS.reset}` : '';
        const details = error || http.error;
        const errorSummary = details?.message
            ? `
  ${COLORS.red}error=${details.name || "Error"}: ${details.message}${COLORS.reset}`
            : "";
        const databaseDetails = [
            details?.code && `code=${details.code}`,
            details?.errno != null && `errno=${details.errno}`,
            details?.sqlState && `sqlState=${details.sqlState}`,
        ].filter(Boolean).join(" ");
        const dbLine = databaseDetails
            ? `
  ${COLORS.red}${databaseDetails}${COLORS.reset}`
            : "";
        const bodyKeys = http.bodyKeys?.length
            ? `
  ${COLORS.dim}bodyKeys=${http.bodyKeys.join(",")}${COLORS.reset}`
            : "";
        const stackTrace = stack ? `
${COLORS.red}${stack}${COLORS.reset}` : "";
        return `${ts} ${lvl} ${ctx}${rid}${method} ${url} ${status} ${dur} ${ip}${user}${errorSummary}${dbLine}${bodyKeys}${stackTrace}`;
    }

    let out = `${ts} ${lvl} ${ctx}${rid}${message}`;
    if (info.controllerName) out += ` ${info.controllerName}`;
    if (info.moduleName) out += ` ${info.moduleName}`;
    if (info.routeMethod) out += ` ${info.routeMethod}`;
    if (info.routePathFingerprint) out += ` path#${info.routePathFingerprint}`;
    if (info.messageFingerprint) out += ` message#${info.messageFingerprint}`;
    if (typeof ms === 'number') out += ` ${durationColor(ms)}`;
    if (stack) out += `\n${COLORS.red}${stack}${COLORS.reset}`;
    return out;
});

// ── File format: structured JSON for easy parsing ────────────────────────
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format((info) => sanitizePersistentLog(info) as unknown as typeof info)(),
    winston.format.json(),
);

const baseFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
);

// ── Transports ───────────────────────────────────────────────────────────
export type BackendLogService = 'api' | 'prevention-worker';

export const createWinstonLogger = (service: BackendLogService) => {
    startLogHeartbeat(service);
    startLogRetention();
    const auditFile = (channel: 'app' | 'error' | 'http') => {
        const filename = path.join(logDir, `.audit-${service}-${logInstance}-${channel}.json`);
        const fd = fs.openSync(filename, 'a', 0o600);
        fs.closeSync(fd);
        fs.chmodSync(filename, 0o600);
        return filename;
    };
    // Distinct filenames avoid cross-process rotation races on the shared log volume.
    const appTransport = logDir ? new winston.transports.DailyRotateFile({
        filename: path.join(logDir, `${service}-${logInstance}-app-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d',
        auditFile: auditFile('app'),
        options: { flags: 'a', mode: 0o600 },
        level: process.env.LOG_LEVEL || 'info',
        format: fileFormat,
    }) : null;

    const errorTransport = logDir ? new winston.transports.DailyRotateFile({
        filename: path.join(logDir, `${service}-${logInstance}-error-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '30d',
        auditFile: auditFile('error'),
        options: { flags: 'a', mode: 0o600 },
        level: 'error',
        format: fileFormat,
    }) : null;

    const httpTransport = service === 'api' && logDir ? new winston.transports.DailyRotateFile({
        filename: path.join(logDir, `${service}-${logInstance}-http-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '14d',
        auditFile: auditFile('http'),
        options: { flags: 'a', mode: 0o600 },
        level: 'info',
        format: winston.format.combine(
            winston.format((info) => (info.http ? info : false))(),
            fileFormat,
        ),
    }) : null;

    return WinstonModule.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
            winston.format((info) => { info.service = service; return info; })(),
            baseFormat,
        ),
        transports: [
            new winston.transports.Console({ format: winston.format.combine(
                winston.format((info) => sanitizePersistentLog(info) as unknown as typeof info)(),
                consoleFormat,
            ) }),
            ...(appTransport ? [appTransport] : []),
            ...(errorTransport ? [errorTransport] : []),
            ...(httpTransport ? [httpTransport] : []),
        ],
    });
};
