import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { installEnvironment, validateInstallPolicy, requireInstallation, productionInstall } from "./full-gate/install-policy.ts";
import { recordSyntheticCommand } from "./full-gate/install-observation.ts";
import { lane, ROOT } from "./full-gate/runner.mjs";
import { execFileSync } from "node:child_process";
import { platformLane, recordInstall } from "./full-gate/platform.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const policy = JSON.parse(readFileSync(new URL("./full-gate/install-policy.json", import.meta.url)));
const binding = { sourceSha: "a".repeat(40), runId: "9", attempt: "1", job: "main-vitest-01", platform: process.platform, arch: process.arch };
function retain(name, receipt) {
  if (!process.env.FULL_GATE_INSTALL_EVIDENCE) return;
  mkdirSync(process.env.FULL_GATE_INSTALL_EVIDENCE,{recursive:true});
  writeFileSync(join(process.env.FULL_GATE_INSTALL_EVIDENCE,`${name}.json`),JSON.stringify(receipt,null,2),{flag:"wx"});
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fg-install-")));
  const source = join(root, "source"); mkdirSync(source);
  for (const file of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"]) writeFileSync(join(source, file), `synthetic ${file}`);
  const entry = join(source, "recorder.mjs");
  writeFileSync(entry, 'console.log(JSON.stringify({env:process.env,argv:process.argv,cwd:process.cwd()})); if(process.argv[2]==="fail") process.exitCode=7; if(process.argv[2]==="timeout") setInterval(()=>{},1000);');
  return { root, source, entry, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
test("unapproved production policy blocks before spawning or creating install roots", async () => {
  const f = fixture();
  try {
    assert.throws(() => validateInstallPolicy(policy, binding), /approval|bootstrap/);
    await assert.rejects(productionInstall({ root: f.source, tempRoot: f.root, binding }), /bootstrap/);
    assert.equal(existsSync(join(f.root, "install-home")), false);
  } finally { f.cleanup(); }
});
for (const [name,mutate,reason] of [
  ["wrong target",p=>{p.targets[0].arch="wrong";},/platform\/architecture/],
  ["Node version range",p=>{p.targets[0].node.version=">=24";},/exact tool version/],
  ["missing executable digest",p=>{p.targets[0].node.executableSha256=null;},/approval/],
  ["wrong pnpm version",p=>{p.targets[0].pnpm.version="10.32.0";},/pnpm entry\/version/],
  ["missing pnpm digest",p=>{p.targets[0].pnpm.entrySha256=null;},/pnpm entry\/version/],
  ["private registry archive",p=>{p.targets[0].pnpm.archiveUrl="https://private.invalid/pnpm.tgz";},/origin/],
  ["source approvals missing",p=>{p.sourceHashes={};},/manifest\/workspace\/lock/],
  ["caller claims bootstrap qualified",p=>{p.bootstrap={complete:true};},/not implemented/],
]) test(`policy rejects ${name} without installer capability`,()=>{
  const tool={version:"24.22.2",executable:"/synthetic/node",executableSha256:"a".repeat(64),archiveUrl:"https://nodejs.org/dist/synthetic.tar.gz",archiveSha256:"b".repeat(64)};
  const p={...structuredClone(policy),targets:[{platform:binding.platform,arch:binding.arch,node:tool,pnpm:{...tool,version:"10.33.0",archiveUrl:"https://registry.npmjs.org/pnpm/-/pnpm-10.33.0.tgz",entry:"/synthetic/pnpm.cjs",entrySha256:"c".repeat(64)}}],sourceHashes:Object.fromEntries(["package.json","pnpm-workspace.yaml","pnpm-lock.yaml"].map(k=>[k,"d".repeat(64)]))};
  mutate(p); assert.throws(()=>validateInstallPolicy(p,binding),reason);
});
test("old guessed receipt is rejected for every lane and cannot be re-qualified by caller fields", () => {
  for (const job of [...Array.from({length:10},(_,i)=>`main-vitest-${String(i+1).padStart(2,"0")}`),"static-checks","electron-node","broker-vitest","control-plane-vitest"]) {
    assert.throws(() => requireInstallation({sourceSha:binding.sourceSha,frozen:true,lockHash:"b".repeat(64)}, {...binding,job}, policy), /installation/);
  }
});
test("public main/static/platform lane entries reject old receipts before source/dependency/resource use", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root,"full-gate-install.json"),JSON.stringify({sourceSha:binding.sourceSha,frozen:true,lockHash:"b".repeat(64)}));
    for (const job of [...Array.from({length:10},(_,i)=>`main-vitest-${String(i+1).padStart(2,"0")}`),"static-checks","electron-node","broker-vitest","control-plane-vitest"]) {
      const env={GITHUB_REPOSITORY:"Ashersun1207/entropybot",GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_JOB:job,GITHUB_SHA:execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim(),GITHUB_RUN_ID:binding.runId,GITHUB_RUN_ATTEMPT:"1",RUNNER_TEMP:f.root};
      await assert.rejects(lane(job,env),/legacy or missing installation/);
      if(job==="broker-vitest"||job==="control-plane-vitest") await assert.rejects(platformLane(job,{...env,FULL_GATE_PLATFORM:job==="broker-vitest"?"linux":"win32"}),/legacy or missing installation/);
    }
    assert.throws(()=>recordInstall(),/post-hoc/);
    assert.equal(existsSync(join(f.root,"full-gate")),false);
    assert.deepEqual(JSON.parse(readFileSync(join(f.root,"full-gate-install.json"))),{sourceSha:binding.sourceSha,frozen:true,lockHash:"b".repeat(64)});
  } finally {f.cleanup();}
});
test("constructed environment rejects duplicate case keys and never copies parent canaries", async () => {
  const f = fixture();
  const original = {};
  const canaries = { NODE_OPTIONS: "--require=/does-not-exist", NoDe_OpTiOnS: "canary", SECRET: "secret-canary", ELECTRON_MIRROR: "mirror-canary", ESBUILD_BINARY_PATH: "binary-canary", HTTPS_PROXY: "proxy-canary", npm_config_registry: "registry-canary", GITHUB_ENV: "command-canary", DYLD_INSERT_LIBRARIES: "loader-canary", LD_PRELOAD: "library-canary", NODE_PATH: "module-canary", NODE_EXTRA_CA_CERTS: "ca-canary", ELECTRON_CACHE: "cache-canary", ELECTRON_CUSTOM_DIR: "dist-canary", ELECTRON_OVERRIDE_DIST_PATH: "override-canary", ELECTRON_SKIP_BINARY_DOWNLOAD: "checksum-canary", npm_config_userconfig: "config-canary", npm_config_cache: "npm-cache-canary", GITHUB_OUTPUT: "output-canary" };
  try {
    for (const [k,v] of Object.entries(canaries)) { original[k]=process.env[k]; process.env[k]=v; }
    assert.throws(()=>installEnvironment({home:join(f.root,"h"),platform:"darwin",path:["/usr/bin"],fixedWindows:{Path:"x",PATH:"y"}}), /duplicate/);
    const r = await recordSyntheticCommand({ root:f.source,tempRoot:f.root,entry:f.entry,args:[],binding,timeoutMs:2000 });
    retain("canaries",r);
    const actual=JSON.parse(r.stdout.trim());
    for (const [k,v] of Object.entries(canaries)) assert.notEqual(actual.env[k],v,k);
    for (const k of Object.keys(canaries).filter(k => !(k in r.command.env))) assert.equal(actual.env[k],undefined,k);
    assert.equal(actual.env.npm_config_registry,"https://registry.npmjs.org/");
    const platformKeys=process.platform==="darwin"?["__CF_USER_TEXT_ENCODING"]:[];
    assert.deepEqual(Object.fromEntries(Object.entries(actual.env).filter(([key])=>!platformKeys.includes(key))),r.command.env);
    assert.ok(Object.keys(actual.env).filter(key=>!(key in r.command.env)).every(key=>platformKeys.includes(key)));
    assert.equal(actual.env.HOME,r.command.env.HOME);
    assert.equal(actual.cwd,f.source);
    assert.deepEqual(actual.argv.slice(1),[f.entry]);
    assert.equal(r.outcome.exitCode,0); assert.equal(r.outcome.stdioClosed,true);
    assert.equal(r.logs.stdout.sha256,hash(r.stdout));
    assert.equal(r.qualification.complete,false); assert.equal(r.frozen,null);
    assert.equal(r.source.before["pnpm-lock.yaml"],hash(readFileSync(join(f.source,"pnpm-lock.yaml"))));
    assert.deepEqual(r.source.before,r.source.after);
    assert.ok(Date.parse(r.finishedAt)>=Date.parse(r.startedAt));
    assert.deepEqual(r.installedEntries,[]); assert.equal(r.lifecycle.networkHistory,"unknown");
    const forged={...r,synthetic:false,frozen:true,qualification:{complete:true},installedEntries:[{path:"forged"}],lifecycle:{status:"qualified"}};
    assert.throws(()=>requireInstallation(forged,binding,policy),/approval/);
    for(const data of [{...r,outcome:{}},{...r,outcome:{...r.outcome,exitCode:7}},{...r,outcome:{...r.outcome,stdioClosed:false}}]) assert.throws(()=>requireInstallation(data,binding,policy),/failed or incomplete/);
    assert.throws(()=>requireInstallation(r,binding,policy), /synthetic|incomplete|approval/);
    for (const mutation of [{job:"static-checks"},{runId:"10"},{attempt:"2"},{sourceSha:"b".repeat(40)},{platform:"win32"}]) assert.throws(()=>requireInstallation(r,{...binding,...mutation},policy));
  } finally {
    for (const [k,v] of Object.entries(original)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; }
    f.cleanup();
  }
});
for (const mode of ["fail","timeout","spawnfail","exit-before-close"]) test(`actual recorder outcome ${mode} never qualifies installation`, async () => {
  const f=fixture();
  try {
    if(mode==="exit-before-close") writeFileSync(f.entry, 'import {spawn} from "node:child_process"; spawn(process.execPath,["-e","setTimeout(()=>{},700)"],{stdio:["ignore",1,2]}); process.exit(0);');
    const r=await recordSyntheticCommand({root:f.source,tempRoot:f.root,entry:f.entry,args:[mode],binding,timeoutMs:mode==="timeout"?150:2000, executable:mode==="spawnfail"?join(f.root,"missing-node"):undefined});
    retain(mode,r);
    assert.equal(r.qualification.complete,false);
    if(mode==="fail") assert.equal(r.outcome.exitCode,7);
    if(mode==="timeout") assert.equal(r.outcome.timedOut,true);
    if(mode==="spawnfail") { assert.equal(r.outcome.spawned,false); assert.equal(r.outcome.exitCode,null); }
    if(mode==="exit-before-close") { assert.equal(r.outcome.exitCode,0); assert.ok(r.outcome.evidence.closeAt>r.outcome.evidence.exitAt); }
    assert.equal(r.logs.stderr.sha256,hash(r.stderr));
    assert.throws(()=>requireInstallation(r,binding,policy));
  } finally {f.cleanup();}
});
test("Windows environment profiles are lexical synthetic checks with fixed OS values",()=>{
  const e=installEnvironment({home:"C:\\owned\\h",platform:"win32",path:["C:\\approved\\bin","C:\\Windows\\System32"],fixedWindows:{SystemRoot:"C:\\Windows",WINDIR:"C:\\Windows",ComSpec:"C:\\Windows\\System32\\cmd.exe",PATHEXT:".COM;.EXE;.BAT;.CMD",SystemDrive:"C:"}});
  assert.equal(e.PATH,"C:\\approved\\bin;C:\\Windows\\System32"); assert.equal(e.GIT_CONFIG_GLOBAL,"NUL");
  assert.equal(e.APPDATA,"C:\\owned\\h\\AppData\\Roaming"); assert.equal(e.LOCALAPPDATA,"C:\\owned\\h\\AppData\\Local");
  assert.throws(()=>installEnvironment({home:"C:\\owned\\h",platform:"win32",path:["C:\\bin"],fixedWindows:{}}),/Windows/);
});
test("recorder refuses preexisting or external owned roots before child launch",async()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.root,"install-home"));
    await assert.rejects(recordSyntheticCommand({root:f.source,tempRoot:f.root,entry:f.entry,args:[],binding,timeoutMs:1000}),/exist/);
    await assert.rejects(recordSyntheticCommand({root:f.source,tempRoot:f.root,entry:join(f.root,"external.mjs"),args:[],binding,timeoutMs:1000}),/entry/);
  } finally {f.cleanup();}
});
