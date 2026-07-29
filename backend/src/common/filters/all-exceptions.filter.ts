import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger('Exception');

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse();
        const req = ctx.getRequest();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const responseBody =
            exception instanceof HttpException
                ? exception.getResponse()
                : { statusCode: status, message: 'Internal server error' };

        const error = exception as any;
        const driverError = error?.driverError;
        const message = error?.message || 'Unhandled exception';
        const stack = error?.stack;

        this.logger.error({
            message: `${req.method} ${req.originalUrl || req.url} → ${status} ${message}`,
            context: 'Exception',
            requestId: req.requestId,
            stack,
            error: {
                name: error?.name || 'Error',
                message,
                // MySQL/TypeORM metadata makes schema and constraint failures
                // diagnosable without logging SQL values or request bodies.
                code: driverError?.code || error?.code,
                errno: driverError?.errno || error?.errno,
                sqlState: driverError?.sqlState || error?.sqlState,
            },
            http: {
                phase: 'exception',
                method: req.method,
                url: req.originalUrl || req.url,
                statusCode: status,
                ip: req.ip,
                userId: req.user?.id || req.user?.userId,
                bodyKeys: Object.keys(req.body || {}),
            },
        } as any);

        const payload =
            typeof responseBody === 'object' && responseBody !== null
                ? responseBody
                : { statusCode: status, message: responseBody };

        res.status(status).json({
            ...(payload as object),
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
            path: req.originalUrl || req.url,
        });
    }
}
