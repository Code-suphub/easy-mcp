import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQuery } from '../dist/read-query.js';
import { validateSQL, formatRows } from '../dist/shared.js';
import { ChannelUnavailableError, buildApps } from '../dist/connections.js';

function cli(args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: new URL('../', import.meta.url), env: { ...process.env, ...env },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('只读校验先于连接，连接失败才允许兜底', async () => {
  let calls = 0;
  const channels = [
    { read: async () => { calls++; throw new ChannelUnavailableError('offline'); } },
    { read: async () => { calls++; return { rows: [{ ok: 1 }] }; } },
  ];
  const app = { name: 'demo', envs: { uat: channels } };
  const apps = new Map([['demo', app], ['alias', app]]);
  await assert.rejects(readQuery(apps, 'demo', 'uat', 'DELETE FROM t'), /只能执行/);
  assert.equal(calls, 0);
  assert.deepEqual((await readQuery(apps, 'alias', 'uat', 'SELECT 1')).rows, [{ ok: 1 }]);
  assert.equal(calls, 2);
  channels[0].read = async () => { throw new Error('SQL error'); };
  await assert.rejects(readQuery(apps, 'demo', 'uat', 'SELECT 1'), /SQL error/);
  assert.equal(calls, 2);
});

test('MySQL 可执行注释与 -- 运算不能绕过只读校验', () => {
  for (const sql of [
    "SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */",
    'SELECT 1 /*! ; DROP TABLE t */',
    "SELECT 1--1 INTO OUTFILE '/tmp/x'",
  ]) {
    assert.equal(validateSQL(sql, 'read', 'mysql').ok, false, sql);
  }
  assert.equal(validateSQL('SELECT 1 -- 普通注释', 'read', 'mysql').ok, true);
  assert.equal(validateSQL('SELECT 1 - -1', 'read', 'mysql').ok, true);
});

test('服务端截断会透传并显式标记', async () => {
  const apps = new Map([['demo', { name: 'demo', envs: {
    prod: [{ read: async () => ({ rows: [{ ok: 1 }], truncated: true }) }],
  } }]]);
  const result = await readQuery(apps, 'demo', 'prod', 'SELECT 1');
  assert.equal(result.truncated, true);
  assert.match(formatRows(result.rows, result.truncated), /只返回首页/);
});

test('二进制列以 base64 输出，BIGINT 不抛错', () => {
  const text = formatRows([{ blob: Buffer.from([0, 255]), big: 9007199254740993n }]);
  assert.match(text, /"encoding": "base64"/);
  assert.match(text, /"data": "AP8="/);
  assert.match(text, /"big": "9007199254740993"/);
  assert.doesNotMatch(text, /"type": "Buffer"/);
});

test('别名冲突必须报错，不能静默路由到别的库', () => {
  assert.throws(() => buildApps({ mode: 'multi', connections: {
    a: { aliases: ['shared'], envs: {} },
    b: { aliases: ['shared'], envs: {} },
  } }), /别名冲突/);
  assert.throws(() => buildApps({ mode: 'multi', connections: {
    a: { aliases: ['b'], envs: {} },
    b: { envs: {} },
  } }), /别名冲突/);
});

test('CLI：帮助、配置列表、DMS 查询、文件输出、错误退出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mysql-cli-'));
  let calls = 0;
  let fail = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls++;
    assert.equal(req.headers.cookie, 'test-cookie');
    assert.equal(JSON.parse(body).sql, 'SELECT 1');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(fail ? { code: 1, message: 'business error' } : {
      code: 0, data: { data_list: [{ item: { ok: 1 } }] },
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = join(dir, 'connections.json');
    const output = join(dir, 'result.json');
    const sqlFile = join(dir, 'query.sql');
    await writeFile(sqlFile, 'SELECT 1');
    await writeFile(config, JSON.stringify({ mode: 'multi', connections: {
      demo: { aliases: ['alias'], envs: { uat: { channels: [{
        type: 'dms', api_url: `http://127.0.0.1:${server.address().port}`,
        cookie_env: 'CLI_TEST_COOKIE', db_name: 'demo', backend_cluster_name: 'test', instance_id: 1,
      }] } } },
    } }));
    assert.equal((await cli(['--help'])).code, 0);
    const listing = await cli(['--config', config, '--list']);
    assert.equal(listing.code, 0);
    assert.equal(JSON.parse(listing.stdout)[0].database, 'demo');
    assert.equal(calls, 0);
    const base = ['--config', config, '--database', 'alias', '--env', 'uat'];
    const result = await cli([...base, '--sql-file', sqlFile, '--output', output], { CLI_TEST_COOKIE: 'test-cookie' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), [{ ok: 1 }]);
    assert.equal((await stat(output)).mode & 0o077, 0, '结果文件不应对组/其他用户可读');
    assert.equal(calls, 1);
    assert.equal((await cli([...base, '--sql', 'DELETE FROM t'])).code, 1);
    assert.equal(calls, 1);
    assert.equal((await cli(['--config', config, '--database', 'demo', '--sql', 'SELECT 1'])).code, 1);
    fail = true;
    const failed = await cli([...base, '--sql', 'SELECT 1'], { CLI_TEST_COOKIE: 'test-cookie' });
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /business error/);
    assert.doesNotMatch(failed.stderr, /所有通道连接失败/);
    fail = false;
    const overwrite = await cli([...base, '--sql', 'SELECT 1', '--output', output], { CLI_TEST_COOKIE: 'test-cookie' });
    assert.equal(overwrite.code, 1);
    assert.match(overwrite.stderr, /已存在/);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), [{ ok: 1 }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
