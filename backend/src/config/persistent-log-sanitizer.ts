import { createHash } from 'crypto';

const EVENT = /^[A-Z][A-Z0-9_]{2,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const HEX = /^[0-9a-f]{16,64}$/i;
const SAFE_FIELDS = new Set([
    'level', 'timestamp', 'service', 'context', 'event', 'organizationId',
    'visitId', 'reportId', 'recoveryRunId', 'groupJobId', 'jobType',
    'correlationId', 'sourceGroupFingerprint', 'errorFingerprint',
    'errorCode', 'errorName', 'upstreamStatus', 'attemptsMade', 'attempts', 'attempt',
    'maxAttempts', 'terminal', 'durationMs', 'stage', 'failedStage', 'status',
    'vectorReason', 'vectorExpectedCount', 'vectorActualCount', 'decision', 'keyHash',
]);

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/** A file-transport boundary: never persist free-form application metadata. */
export function sanitizePersistentLog(info: Record<string | symbol, unknown>): Record<string | symbol, unknown> {
    const rawMessage = typeof info.message === 'string' ? info.message : '';
    const rawEvent = typeof info.event === 'string' ? info.event : '';
    const context = typeof info.context === 'string' ? info.context : '';
    const route = context === 'RouterExplorer'
        ? rawMessage.match(/^Mapped \{(\/[A-Za-z0-9/:._-]{1,160}), (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\} route$/)
        : null;
    const controller = context === 'RoutesResolver'
        ? rawMessage.match(/^([A-Za-z][A-Za-z0-9]{0,79}Controller) \{(\/[A-Za-z0-9/:._-]{1,160})\}:$/)
        : null;
    const module = context === 'InstanceLoader'
        ? rawMessage.match(/^([A-Za-z][A-Za-z0-9]{0,79}Module) dependencies initialized$/)
        : null;
    const httpPhase = context === 'HTTP' && info.http && typeof info.http === 'object'
        ? (info.http as Record<string, unknown>).phase : undefined;
    const nestEvent = route ? 'NEST_ROUTE_MAPPED' : controller ? 'NEST_CONTROLLER_DISCOVERED' :
        module ? 'NEST_MODULE_INITIALIZED' :
        context === 'NestFactory' && rawMessage === 'Starting Nest application...' ? 'NEST_APPLICATION_STARTING' :
        context === 'NestApplication' && rawMessage === 'Nest application successfully started' ? 'NEST_APPLICATION_STARTED' :
        context === 'Bootstrap' && /^Server is running on: http:\/\/localhost:\d{1,5}\/api$/.test(rawMessage) ? 'BACKEND_API_STARTED' :
        context === 'PreventionWorkerRuntimeService' && rawMessage === 'Prevention worker runtime ready' ? 'PREVENTION_WORKER_READY' :
        httpPhase === 'request' ? 'HTTP_REQUEST' : httpPhase === 'response' ? 'HTTP_RESPONSE' : undefined;
    const event = EVENT.test(rawEvent) ? rawEvent : EVENT.test(rawMessage) ? rawMessage : nestEvent;
    const retained: Record<string | symbol, unknown> = {};
    for (const key of Reflect.ownKeys(info)) {
        if (typeof key === 'symbol') {
            if (key === Symbol.for('level')) retained[key] = info[key];
            continue;
        }
        if (!SAFE_FIELDS.has(key)) continue;
        const value = info[key];
        if (key === 'level' || key === 'service' || key === 'context' || key === 'jobType' ||
            key === 'stage' || key === 'failedStage' || key === 'status' || key === 'errorName' || key === 'vectorReason') {
            if (typeof value === 'string' && TOKEN.test(value)) retained[key] = value;
        } else if (key === 'timestamp') {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) retained[key] = value;
        } else if (key.endsWith('Id') && key !== 'correlationId') {
            if (typeof value === 'string' && UUID.test(value)) retained[key] = value;
        } else if (key.endsWith('Fingerprint') || key === 'correlationId' || key === 'keyHash') {
            if (typeof value === 'string' && HEX.test(value)) retained[key] = value;
        } else if (key === 'decision') {
            if (typeof value === 'string' && /^(?:ALLOW|ALLOW_LEGACY|ALLOW_VERIFIED|DENY)$/.test(value)) retained[key] = value;
        } else if (key === 'event' || key === 'errorCode') {
            if (typeof value === 'string' && EVENT.test(value)) retained[key] = value;
        } else if (key === 'terminal') {
            if (typeof value === 'boolean') retained[key] = value;
        } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000) {
            retained[key] = value;
        }
    }
    if (event) retained.event = event;
    retained.message = event ?? 'UNSTRUCTURED_LOG_MESSAGE';
    if (!event && rawMessage) retained.messageFingerprint = fingerprint(rawMessage);
    if (route) {
        retained.routeMethod = route[2];
        retained.routePathFingerprint = fingerprint(route[1]);
    }
    if (controller) {
        retained.controllerName = controller[1];
        retained.routePathFingerprint = fingerprint(controller[2]);
    }
    if (module) retained.moduleName = module[1];
    if (typeof info.requestId === 'string' && info.requestId.length <= 100) retained.requestId = fingerprint(info.requestId);

    const http = info.http;
    if (http && typeof http === 'object' && !Array.isArray(http)) {
        const request = http as Record<string, unknown>;
        const safeHttp: Record<string, unknown> = {};
        if (request.phase === 'request' || request.phase === 'response') safeHttp.phase = request.phase;
        if (typeof request.method === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(request.method)) safeHttp.method = request.method;
        if (typeof request.url === 'string') safeHttp.pathFingerprint = fingerprint(request.url.split('?', 1)[0]);
        if (typeof request.statusCode === 'number' && Number.isInteger(request.statusCode) && request.statusCode >= 100 && request.statusCode <= 599) safeHttp.statusCode = request.statusCode;
        if (typeof request.durationMs === 'number' && Number.isFinite(request.durationMs) && request.durationMs >= 0 && request.durationMs <= 86_400_000) safeHttp.durationMs = request.durationMs;
        retained.http = safeHttp;
    }
    return retained;
}
