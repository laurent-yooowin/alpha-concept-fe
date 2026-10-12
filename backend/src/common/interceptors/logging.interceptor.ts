import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { randomUUID } from 'crypto';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger('HTTP');

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const http = context.switchToHttp();
        const req = http.getRequest();
        const res = http.getResponse();

        const suppliedRequestId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
        const requestId = typeof suppliedRequestId === 'string' &&
            /^[A-Za-z0-9._-]{1,100}$/.test(suppliedRequestId)
            ? suppliedRequestId
            : randomUUID();
        req.requestId = requestId;
        try { res.setHeader('x-request-id', requestId); } catch { /* noop */ }

        const start = process.hrtime.bigint();
        const { method, originalUrl, url, ip, headers } = req;
        const rawUrl = String(originalUrl || url || '/');
        const fullUrl = rawUrl.split('?', 1)[0];
        const userAgent = headers['user-agent'];
        const userId = req.user?.id || req.user?.userId;

        // Inbound
        this.logger.log({
            message: `→ ${method} ${fullUrl}`,
            context: 'HTTP',
            requestId,
            http: {
                phase: 'request',
                method,
                url: fullUrl,
                ip,
                userAgent,
                userId,
            },
        } as any);

        const finish = (statusCode: number, error?: any) => {
            const durationMs = Number((process.hrtime.bigint() - start) / 1000000n);
            const contentLength = res.getHeader?.('content-length');
            const payload: any = {
                message: `← ${method} ${fullUrl} ${statusCode} ${durationMs}ms`,
                context: 'HTTP',
                requestId,
                http: {
                    phase: 'response',
                    method,
                    url: fullUrl,
                    statusCode,
                    durationMs,
                    contentLength,
                    ip,
                    userAgent,
                    userId,
                },
            };
            if (error) {
                payload.http.error = {
                    name: error.name,
                    message: 'Request failed',
                    code: typeof error.code === 'string' ? error.code.slice(0, 64) : undefined,
                };
                this.logger.error(payload);
            } else if (statusCode >= 500) {
                this.logger.error(payload);
            } else if (statusCode >= 400) {
                this.logger.warn(payload);
            } else {
                this.logger.log(payload);
            }
        };

        return next.handle().pipe(
            tap(() => finish(res.statusCode)),
            catchError((err) => {
                const status = err?.status || err?.statusCode || 500;
                finish(status, err);
                return throwError(() => err);
            }),
        );
    }
}
