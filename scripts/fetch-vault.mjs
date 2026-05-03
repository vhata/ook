#!/usr/bin/env node
// Prebuild step: fetch the books vault into a temp dir on the build server.
//
// Reads BOOKS_DEPLOY_KEY (an SSH private key, base64 or PEM) from env,
// writes it to a tempfile, configures git to use it for the books repo,
// and clones BOOKS_REPO into BOOKS_CHECKOUT_DIR. The Next.js build then
// reads from BOOKS_CHECKOUT_DIR via process.env.BOOKS_DIR.
//
// Local development: this script no-ops if BOOKS_DEPLOY_KEY is unset
// (so `make build` keeps working without the key on your laptop).

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BOOKS_REPO = process.env.BOOKS_REPO ?? "git@github.com:vhata/books.git";
// Clone INSIDE the project so Next.js's file-tracing can include the markdown
// in the deployed function bundle. .vault/ is gitignored locally.
const BOOKS_CHECKOUT_DIR = resolve(process.env.BOOKS_CHECKOUT_DIR ?? join(process.cwd(), ".vault"));
const DEPLOY_KEY = process.env.BOOKS_DEPLOY_KEY;

function log(msg) {
  process.stdout.write(`[fetch-vault] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[fetch-vault] ERROR: ${msg}\n`);
  process.exit(1);
}

if (!DEPLOY_KEY) {
  log("BOOKS_DEPLOY_KEY not set — skipping (local dev mode).");
  process.exit(0);
}

// Materialise the deploy key with strict perms.
const sshDir = join(tmpdir(), "ook-ssh");
mkdirSync(sshDir, { recursive: true, mode: 0o700 });
const keyPath = join(sshDir, "books_deploy_key");

// Accept either PEM or base64-encoded PEM. Base64 is convenient for env
// vars that don't survive newlines well (e.g. some CI UIs).
let keyContent = DEPLOY_KEY.trim();
if (!keyContent.startsWith("-----BEGIN")) {
  try {
    keyContent = Buffer.from(keyContent, "base64").toString("utf8").trim();
  } catch {
    fail("BOOKS_DEPLOY_KEY does not look like PEM and isn't valid base64");
  }
}
if (!keyContent.endsWith("\n")) keyContent += "\n";
writeFileSync(keyPath, keyContent, { mode: 0o600 });
chmodSync(keyPath, 0o600);

// Tell git to use this key + skip host key prompts for github.com.
const gitSshCmd = `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
process.env.GIT_SSH_COMMAND = gitSshCmd;

// Clone (or refresh) the books repo.
if (existsSync(join(BOOKS_CHECKOUT_DIR, ".git"))) {
  log(`Refreshing existing checkout at ${BOOKS_CHECKOUT_DIR}`);
  execSync(`git -C ${BOOKS_CHECKOUT_DIR} fetch --depth 1 origin main`, {
    stdio: "inherit",
    env: { ...process.env, GIT_SSH_COMMAND: gitSshCmd },
  });
  execSync(`git -C ${BOOKS_CHECKOUT_DIR} reset --hard origin/main`, {
    stdio: "inherit",
  });
} else {
  log(`Cloning ${BOOKS_REPO} into ${BOOKS_CHECKOUT_DIR}`);
  execSync(`git clone --depth 1 ${BOOKS_REPO} ${BOOKS_CHECKOUT_DIR}`, {
    stdio: "inherit",
    env: { ...process.env, GIT_SSH_COMMAND: gitSshCmd },
  });
}

log(`Vault ready at ${BOOKS_CHECKOUT_DIR}`);
log(`Set BOOKS_DIR=${BOOKS_CHECKOUT_DIR} for the build (Vercel does this via project env).`);
