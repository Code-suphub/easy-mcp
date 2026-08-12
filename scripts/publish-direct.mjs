#!/usr/bin/env node
/**
 * 直接 HTTP PUT 发布到 npm registry。
 *
 * 背景：npm publish 客户端在当前 npm 版本（11.11.0 及更新的 npm@latest）
 * 下对 @easy-mcps/* 的发布请求一律被 registry 返回 403，
 * 但用相同 token 直接 PUT（完整 packument + tarball 附件）返回 200。
 * 本脚本绕过 npm publish 客户端，用与 npm registry 兼容的 CouchDB
 * 风格请求完成发布。
 *
 * 用法：node scripts/publish-direct.mjs <包目录>
 * 环境变量：NODE_AUTH_TOKEN（npm 认证 token，必填）
 */
import { readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import https from 'node:https';
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
const filename = packOut.split('\n').pop().trim();
const tgzPath = resolve(tmpdir(), filename);
const tgz = readFileSync(tgzPath);

let readme = '';
try {
  readme = readFileSync(resolve(pkgDir, 'README.md'), 'utf8');
} catch {}

const versionMeta = {
  ...pkg,
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
  readme,
  _attachments: {
    [`${short}-${version}.tgz`]: {
      content_type: 'application/octet-stream',
      data: tgz.toString('base64'),
      length: tgz.length,
    },
  },
};

const body = JSON.stringify(packument);
const ua = `npm/11.11.0 node/${process.version} ${process.platform} ${process.arch} workspaces/false`;
const req = https.request(
  {
    hostname: 'registry.npmjs.org',
    path: `/${encodeURIComponent(name)}`,
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    let buf = '';
    res.on('data', (c) => (buf += c));
    res.on('end', () => {
      rmSync(tgzPath, { force: true });
      console.log(`publish ${name}@${version} -> HTTP ${res.statusCode}`);
      console.log(`cf-ray: ${res.headers['cf-ray']} cf-mitigated: ${res.headers['cf-mitigated']}`);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('SUCCESS');
        process.exit(0);
      }
      console.error(buf.slice(0, 3000));
      process.exit(1);
    });
  }
);
req.on('error', (e) => {
  rmSync(tgzPath, { force: true });
  console.error(e.message);
  process.exit(1);
});
req.write(body);
req.end();
