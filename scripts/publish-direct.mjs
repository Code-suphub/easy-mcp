#!/usr/bin/env node
/**
 * 直接发布到 npm registry，使用 curl 发送 PUT。
 *
 * 背景：npm publish 客户端与 Node https 模块的 TLS 指纹会被 npm 前端的
 * Cloudflare WAF 拦截（返回 403 "blocked"），而 curl 的 TLS 指纹可通过。
 * 本脚本用 curl 发送 CouchDB 风格的发布请求。
 *
 * 用法：node scripts/publish-direct.mjs <包目录>
 * 环境变量：NODE_AUTH_TOKEN（npm 认证 token，必填）
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const pkgDir = resolve(process.argv[2] || '.');
const token = process.env.NODE_AUTH_TOKEN;
if (!token) {
  console.error('NODE_AUTH_TOKEN env is required');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
const { name, version } = pkg;
const short = name.split('/')[1];

const packOut = execFileSync('npm', ['pack', '--pack-destination', tmpdir()], { cwd: pkgDir }).toString().trim();
const tgzPath = resolve(tmpdir(), packOut.split('\n').pop().trim());
const tgz = readFileSync(tgzPath);

const versionMeta = {
  name,
  version,
  description: pkg.description,
  main: pkg.main,
  type: pkg.type,
  bin: pkg.bin,
  keywords: pkg.keywords,
  license: pkg.license,
  engines: pkg.engines,
  dependencies: pkg.dependencies,
  repository: pkg.repository,
  homepage: pkg.homepage,
  bugs: pkg.bugs,
  dist: {
    shasum: createHash('sha1').update(tgz).digest('hex'),
    integrity: 'sha512-' + createHash('sha512').update(tgz).digest('base64'),
    tarball: `https://registry.npmjs.org/${encodeURIComponent(name)}/-/${short}-${version}.tgz`,
  },
};

const packument = {
  _id: name,
  name,
  description: pkg.description,
  'dist-tags': { latest: version },
  versions: { [version]: versionMeta },
  _attachments: {
    [`${short}-${version}.tgz`]: {
      content_type: 'application/octet-stream',
      data: tgz.toString('base64'),
      length: tgz.length,
    },
  },
};

const bodyFile = resolve(tmpdir(), `pack-${name.replace(/[/@]/g, '-')}-${version}.json`);
const respFile = resolve(tmpdir(), `pack-resp-${Date.now()}.json`);
writeFileSync(bodyFile, JSON.stringify(packument));

try {
  const status = execFileSync(
    'curl',
    [
      '-s', '-o', respFile, '-w', '%{http_code}',
      '-X', 'PUT',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'Content-Type: application/json',
      '--data', `@${bodyFile}`,
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    ],
    { encoding: 'utf8' }
  ).trim();

  const resp = readFileSync(respFile, 'utf8');
  console.log(`publish ${name}@${version} -> HTTP ${status}`);
  if (status >= 200 && status < 300) {
    console.log('SUCCESS');
    process.exit(0);
  }
  try {
    const j = JSON.parse(resp);
    console.error(`ERROR: ${j.error || resp.slice(0, 500)}`);
  } catch {
    console.error(resp.slice(0, 500));
  }
  process.exit(1);
} finally {
  rmSync(bodyFile, { force: true });
  rmSync(respFile, { force: true });
  rmSync(tgzPath, { force: true });
}
