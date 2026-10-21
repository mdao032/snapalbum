// Local S3 emulator (VersityGW) for the storage integration tests: `pnpm storage:start` / `storage:stop`.
// R2 speaks the S3 protocol, so the tests run against the emulator and need no Cloudflare account.
import { execFileSync, spawnSync } from "node:child_process";

const NAME = "snapalbum-s3";
// VersityGW v1.9.0 (S3 gateway over a local folder), pinned by digest so the tests behave the same
// everywhere. MinIO, first planned, no longer publishes its images.
const IMAGE =
  "ghcr.io/versity/versitygw@sha256:eb7f786fcd91e72194e48fcf1ac16302d686bf8e3a71434bdbc067a6efd3fdc7";
const PORT = process.env.S3_TEST_PORT ?? "9100";

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

function isRunning() {
  const result = docker(["ps", "--filter", `name=^${NAME}$`, "--format", "{{.Names}}"]);
  return result.stdout.trim() === NAME;
}

async function waitUntilReady() {
  // Any HTTP answer (even "access denied" for an anonymous request) means the gateway listens.
  const url = `http://127.0.0.1:${PORT}/`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(url);
      return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The S3 emulator did not become ready on port ${PORT}`);
}

const command = process.argv[2];

if (command === "start") {
  if (!isRunning()) {
    docker(["rm", "-f", NAME]);
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        NAME,
        "-p",
        `127.0.0.1:${PORT}:7070`,
        "--tmpfs",
        "/data",
        "-e",
        "ROOT_ACCESS_KEY=snapalbum",
        "-e",
        "ROOT_SECRET_KEY=snapalbum-secret",
        IMAGE,
        "posix",
        "/data",
      ],
      { stdio: "inherit" },
    );
  }
  await waitUntilReady();
  console.log(`S3 emulator ready on http://127.0.0.1:${PORT} (user snapalbum / snapalbum-secret)`);
} else if (command === "stop") {
  docker(["rm", "-f", NAME]);
  console.log("S3 emulator stopped");
} else {
  console.error("Usage: node scripts/storage-emulator.mjs start|stop");
  process.exit(1);
}
