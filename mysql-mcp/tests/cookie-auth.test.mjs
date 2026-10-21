import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const loader = new URL('../dist/cookie-auth.js', import.meta.url).href;
const connector = new URL('../dist/connections.js', import.meta.url).href;
const cliPath = new URL('../dist/cli.js', import.meta.url);
const url = 'https://cloud.bilibili.co/rds/v1/dms/query_data';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dms-auth-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const helper = join(home, 'toolkit-fixture');
  await writeFile(helper, `#!/usr/bin/env node
const fs = require('node:fs'),path=require('node:path');
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['auth','ensure']))process.exit(4);
fs.appendFileSync(path.join(process.env.HOME,'calls'), 'ensure\\n');
if(process.env.FIXTURE_MODE==='fail'){console.log('fixture-leaked-secret');console.error('fixture-leaked-secret');process.exit(1);}
if(process.env.FIXTURE_MODE==='noop')process.exit(0);
setTimeout(()=>{fs.writeFileSync(path.join(process.env.HOME,'.bi-cookie'),'cookie=fixture-private\\n',{mode:0o600});fs.chmodSync(path.join(process.env.HOME,'.bi-cookie'),0o600);console.log(JSON.stringify({updated:true}));},30);
`, {mode:0o700});
  return {home, helper};
}

function child(f, script, env={}) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, Array.isArray(script) ? script : ['--input-type=module', '-e', script], {
      env:{...process.env, HOME:f.home, MCP_TOOLKIT_BIN:f.helper, DMS_AUTH_TEST_COOKIE:'', ...env},
    });
    let stdout='',stderr='';
    processChild.stdout.on('data', b=>stdout+=b);
    processChild.stderr.on('data', b=>stderr+=b);
    processChild.on('error', reject);
    processChild.on('close', code=>resolve({code,stdout,stderr}));
  });
}

function script(options={}) {
  return `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {loadDmsCookie} = await import(${JSON.stringify(loader)});
const root=process.env.HOME, file=path.join(root,'.bi-cookie');
const config=${JSON.stringify({api_url:url,cookie_env:'DMS_AUTH_TEST_COOKIE',cookie_file:'~/.bi-cookie',...options.config})};
let ok=true,message='';
try {
 const values=await Promise.all(Array.from({length:${options.parallel || 1}},()=>loadDmsCookie(config)));
 assert(values.every(v=>v===${JSON.stringify(options.expected || 'cookie=fixture-private')}));
}catch(error){ok=false;message=error.message;}
const calls=fs.existsSync(path.join(root,'calls'))?fs.readFileSync(path.join(root,'calls'),'utf8').trim().split('\\n').length:0;
console.log(JSON.stringify({ok,message,calls,exists:fs.existsSync(file),mode:fs.existsSync(file)?fs.statSync(file).mode&511:null}));
`;
}

test('missing/empty/whitespace default files bootstrap through metadata-only auth ensure', async t=>{
  for(const value of [null,'',' \n\t']) {
    const f=await fixture(t);
    if(value!==null)await writeFile(join(f.home,'.bi-cookie'),value);
    const result=await child(f,script());
    assert.equal(result.code,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{ok:true,message:'',calls:1,exists:true,mode:0o600});
    assert.doesNotMatch(result.stdout,/fixture-private/);
    assert.equal(result.stderr,'');
  }
});

test('existing files and explicit environment credentials take precedence over toolkit',async t=>{
  const f=await fixture(t);await writeFile(join(f.home,'.bi-cookie'),'old=preserved\n');
  for(const [env,expected] of [[{},'old=preserved'],[{DMS_AUTH_TEST_COOKIE:'environment=value'},'environment=value']]) {
    const result=await child(f,script({expected}),{FIXTURE_MODE:'fail',...env});
    assert.equal(JSON.parse(result.stdout).ok,true);
    assert.equal(JSON.parse(result.stdout).calls,0);
    assert.equal(await readFile(join(f.home,'.bi-cookie'),'utf8'),'old=preserved\n');
  }
});

test('custom missing/empty files do not bootstrap or overwrite their source',async t=>{
  for(const value of [null,'','custom=value']) {
    const f=await fixture(t),custom=join(f.home,'custom-cookie');
    if(value!==null)await writeFile(custom,value);
    const result=await child(f,script({config:{cookie_file:custom},expected:'custom=value'}));
    const data=JSON.parse(result.stdout);
    assert.equal(data.ok,value==='custom=value');assert.equal(data.calls,0);assert.equal(data.exists,false);
  }
});

test('helper failure or missing installation is sanitized and leaves empty files untouched',async t=>{
  for(const extra of [{FIXTURE_MODE:'fail'},{FIXTURE_MODE:'noop'},{MCP_TOOLKIT_BIN:'/does-not-exist/toolkit'}]) {
    const f=await fixture(t);await writeFile(join(f.home,'.bi-cookie'),'');
    const result=await child(f,script(),extra),data=JSON.parse(result.stdout);
    assert.equal(data.ok,false);
    assert.doesNotMatch(result.stdout+result.stderr,/fixture-leaked-secret/);
    assert.equal(await readFile(join(f.home,'.bi-cookie'),'utf8'),'');
  }
});

test('default symlinks and malformed nonempty Cookies fail without importing',async t=>{
  for(const kind of ['symlink','malformed']) {
    const f=await fixture(t);
    if(kind==='symlink') {
      await writeFile(join(f.home,'target'),'target=preserved');
      await symlink(join(f.home,'target'),join(f.home,'.bi-cookie'));
    }else await writeFile(join(f.home,'.bi-cookie'),'bad\r\nheader');
    const data=JSON.parse((await child(f,script())).stdout);
    assert.equal(data.ok,false);assert.equal(data.calls,0);
    if(kind==='symlink')assert.equal(await readFile(join(f.home,'target'),'utf8'),'target=preserved');
  }
});

test('browser bootstrap is restricted to trusted internal DMS HTTPS endpoints',async t=>{
  for(const api_url of ['http://cloud.bilibili.co/rds/v1/dms/query_data','https://evil.invalid/rds/v1/dms/query_data','https://cloud.bilibili.co/other']) {
    const f=await fixture(t);
    const data=JSON.parse((await child(f,script({config:{api_url}}))).stdout);
    assert.equal(data.ok,false);assert.equal(data.calls,0);assert.equal(data.exists,false);
  }
});

test('existing default Cookie is not sent to an untrusted endpoint', async t=>{
  const f=await fixture(t);
  await writeFile(join(f.home,'.bi-cookie'),'cookie=fixture-private',{mode:0o600});
  const data=JSON.parse((await child(f,script({config:{api_url:'https://evil.invalid/rds/v1/dms/query_data',cookie_env:''}}))).stdout);
  assert.equal(data.ok,false);
  assert.match(data.message,/默认 DMS Cookie 仅允许/);
  assert.equal(data.calls,0);
});

test('an explicitly configured Cookie file may target another endpoint', async t=>{
  const f=await fixture(t);
  await writeFile(join(f.home,'custom-cookie'),'cookie=custom',{mode:0o600});
  const data=JSON.parse((await child(f,script({config:{api_url:'https://example.invalid/dms',cookie_file:'~/custom-cookie',cookie_env:''},expected:'cookie=custom'}))).stdout);
  assert.equal(data.ok,true,JSON.stringify(data));
});

test('parallel reads share one bootstrap attempt',async t=>{
  const f=await fixture(t),data=JSON.parse((await child(f,script({parallel:8}))).stdout);
  assert.equal(data.ok,true);assert.equal(data.calls,1);
});

test('DMS connector reuses bootstrap and sends one query; rejected existing auth does not refresh/replay',async t=>{
  for(const rejected of [false,true]) {
    const f=await fixture(t);
    if(rejected)await writeFile(join(f.home,'.bi-cookie'),'cookie=fixture-private');
    const result=await child(f,`
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const {DmsConnector}=await import(${JSON.stringify(connector)});
let requests=0;
globalThis.fetch=async(endpoint,options)=>{requests++;assert.equal(endpoint,${JSON.stringify(url)});assert.equal(options.headers.Cookie,'cookie=fixture-private');assert.equal(JSON.parse(options.body).sql,'SELECT 1');return {ok:${!rejected},status:401,text:async()=>'',json:async()=>({code:0,data:{data_list:[{item:{ok:1}}]}})};};
const client=new DmsConnector({type:'dms',api_url:${JSON.stringify(url)},cookie_file:'~/.bi-cookie',db_name:'demo',backend_cluster_name:'fixture',instance_id:1});
try{assert.deepEqual((await client.read('SELECT 1')).rows,[{ok:1}]);assert.equal(${rejected},false);}catch(error){assert.equal(${rejected},true);assert.match(error.message,/DMS HTTP 401/);}
assert.equal(requests,1);
assert.equal(fs.existsSync(path.join(process.env.HOME,'calls')),${!rejected});
console.log('ok');`);
    assert.equal(result.code,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
  }
});

test('CLI list and invalid SQL never invoke the authentication helper',async t=>{
  const f=await fixture(t),config=join(f.home,'db.json');
  await writeFile(config,JSON.stringify({mode:'multi',connections:{demo:{envs:{prod:{channels:[{type:'dms',api_url:url,cookie_file:'~/.bi-cookie',db_name:'demo',backend_cluster_name:'fixture',instance_id:1}]}}}}}));
  for(const args of [['--config',config,'--list'],['--config',config,'--database','demo','--env','prod','--sql','DELETE FROM t']]) {
    const result=await child(f,[cliPath.pathname,...args]);
    assert.equal(result.code,args.includes('--list')?0:1,result.stderr);
    await assert.rejects(readFile(join(f.home,'calls')),{code:'ENOENT'});
  }
});
