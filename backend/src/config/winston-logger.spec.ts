import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const writeAt = (directory: string, name: string, contents: string, at: number) => {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, contents, { mode: 0o644 });
    fs.utimesSync(filename, at / 1000, at / 1000);
    return filename;
};

test('API and worker use distinct private persistent transports and audit files', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-logs-'));
    const prior = process.env.LOG_DIR;
    process.env.LOG_DIR = directory;
    try {
        const { createWinstonLogger } = await import('./winston-logger');
        const api = createWinstonLogger('api');
        const worker = createWinstonLogger('prevention-worker');
        api.log({ message: 'API_LOG_TEST', event: 'API_LOG_TEST', secret: 'never-persist' } as any);
        worker.log({ message: 'WORKER_LOG_TEST', event: 'WORKER_LOG_TEST', secret: 'never-persist' } as any);
        const deadline = Date.now() + 2000;
        let apiFile = '';
        let workerFile = '';
        while (Date.now() < deadline) {
            const names = fs.readdirSync(directory);
            apiFile = names.find((name) => /^api-.*-app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) || '';
            workerFile = names.find((name) => /^prevention-worker-.*-app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) || '';
            if (apiFile && workerFile && fs.readFileSync(path.join(directory, apiFile), 'utf8').includes('API_LOG_TEST') &&
                fs.readFileSync(path.join(directory, workerFile), 'utf8').includes('WORKER_LOG_TEST')) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(apiFile && workerFile, 'both transports write to separate files');
        assert.match(fs.readFileSync(path.join(directory, apiFile), 'utf8'), /API_LOG_TEST/);
        assert.match(fs.readFileSync(path.join(directory, workerFile), 'utf8'), /WORKER_LOG_TEST/);
        assert.doesNotMatch(fs.readFileSync(path.join(directory, apiFile), 'utf8'), /never-persist/);
        for (const name of fs.readdirSync(directory).filter((value) => value.endsWith('.log') || value.startsWith('.audit-'))) {
            assert.equal(fs.statSync(path.join(directory, name)).mode & 0o077, 0, `${name} must be private`);
        }
        (api as any).getWinstonLogger().close();
        (worker as any).getWinstonLogger().close();
    } finally {
        if (prior === undefined) delete process.env.LOG_DIR;
        else process.env.LOG_DIR = prior;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('retention preserves active segments and audits, then removes them after heartbeat expiry', async () => {
    const { pruneLogDirectory } = await import('./winston-logger');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-retention-'));
    const now = Date.parse('2026-10-08T12:00:00Z');
    const old = now - 31 * 86_400_000;
    try {
        const marker = writeAt(directory, '.active-api-host-123.heartbeat', '', now);
        const active = writeAt(directory, 'api-host-123-app-2026-09-01.log.1', 'active', old);
        const closed = writeAt(directory, 'api-host-123-app-2026-09-01.log', 'closed', old);
        const audit = writeAt(directory, '.audit-api-host-123-app.json', '{}', old);
        const staleAudit = writeAt(directory, '.audit-api-host-999-app.json', '{}', old);
        const legacyAudit = writeAt(directory, `.${'a'.repeat(40)}-audit.json`, '{}', old);
        pruneLogDirectory(directory, now, 1);
        assert.ok(fs.existsSync(active));
        assert.ok(fs.existsSync(audit));
        assert.equal(fs.statSync(audit).mode & 0o077, 0);
        assert.ok(!fs.existsSync(closed));
        assert.ok(!fs.existsSync(staleAudit));
        assert.ok(!fs.existsSync(legacyAudit));
        fs.utimesSync(marker, (now - 240_000) / 1000, (now - 240_000) / 1000);
        pruneLogDirectory(directory, now, 1);
        assert.ok(!fs.existsSync(active));
        assert.ok(!fs.existsSync(audit));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
