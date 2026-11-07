import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function run(failures: number, deployStatus = 0, enabled = "true", probeStatus = 255) {
  const dir = await mkdtemp(join(tmpdir(), "deploy-vm-test-"));
  try {
    const bin = join(dir, "bin"), log = join(dir, "calls.jsonl");
    await mkdir(bin);
    const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify({tool:require('node:path').basename(process.argv[1]),args})+'\\n');
if (require('node:path').basename(process.argv[1]) !== 'gcloud') process.exit(0);
if (args[0] === 'compute' && args[1] === 'ssh') {
  const key = args.find(x=>x.startsWith('--ssh-key-file=')).split('=')[1];
  fs.writeFileSync(key+'.pub','test public key');
  if (args.includes('--command=true')) {
    const path=process.env.DEPLOY_TEST_LOG+'.count';
    const n=fs.existsSync(path)?Number(fs.readFileSync(path,'utf8')):0;
    fs.writeFileSync(path,String(n+1));
    process.exit(n<Number(process.env.DEPLOY_TEST_FAILURES)?Number(process.env.DEPLOY_TEST_PROBE_STATUS):0);
  }
  process.exit(Number(process.env.DEPLOY_TEST_DEPLOY_STATUS));
}
`;
    for (const name of ["gcloud", "mkdir", "chmod", "sleep"]) await writeFile(join(bin, name), fake, { mode: 0o755 });
    const result = spawnSync("bash", [resolve("infra/deploy-vm.sh"), "project", "zone", "instance", "registry/app:version", enabled], {
      // The Node-based command fakes must not inherit the test runner protocol.
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir,
        DEPLOY_TEST_LOG: log, DEPLOY_TEST_FAILURES: String(failures), DEPLOY_TEST_DEPLOY_STATUS: String(deployStatus), DEPLOY_TEST_PROBE_STATUS: String(probeStatus) },
      encoding: "utf8",
    });
    const calls: { tool: string; args: string[] }[] = await readFile(log, "utf8").then(text => text.trim().split("\n").map(line => JSON.parse(line))).catch(() => []);
    return { ...result, calls };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const ssh = (calls: {tool:string;args:string[]}[]) => calls.filter(c => c.tool === "gcloud" && c.args[1] === "ssh");

test("deployment waits for SSH authentication and runs the remote deployment once", async () => {
  const result = await run(2);
  assert.equal(result.status, 0, result.stderr);
  const commands = ssh(result.calls);
  assert.equal(commands.filter(c => c.args.includes("--command=true")).length, 3);
  assert.equal(commands.filter(c => c.args.some(a => a.includes("deploy.py"))).length, 1);
  assert.equal(result.calls.filter(c => c.tool === "sleep").length, 2);
  assert.equal(result.calls[0].tool, "mkdir");
  assert.equal(result.calls[1].tool, "chmod");
  assert.ok(commands.every(c => c.args.includes("--project=project") && c.args.includes("--ssh-key-expire-after=10m")));
  assert.equal(result.calls.at(-1)?.args[2], "ssh-keys");
  assert.ok(result.calls.at(-1)?.args.includes("remove"));
});

test("three SSH failures clean up the key without attempting deployment", async () => {
  const result = await run(3);
  assert.equal(result.status, 255);
  assert.equal(ssh(result.calls).length, 3);
  assert.ok(ssh(result.calls).every(c => c.args.includes("--command=true")));
  assert.ok(result.calls.at(-1)?.args.includes("remove"));
});

test("a remote deployment failure is never retried and keeps its exit status", async () => {
  const result = await run(0, 17);
  assert.equal(result.status, 17);
  assert.equal(ssh(result.calls).length, 2);
  assert.equal(result.calls.filter(c => c.tool === "sleep").length, 0);
  assert.ok(result.calls.at(-1)?.args.includes("remove"));
});

test("non-SSH failures fail immediately and disabled deployment does nothing", async () => {
  const failure = await run(3, 0, "true", 1);
  assert.equal(failure.status, 1);
  assert.equal(ssh(failure.calls).length, 1);
  const disabled = await run(0, 0, "false");
  assert.equal(disabled.status, 0);
  assert.equal(disabled.calls.length, 0);
});
