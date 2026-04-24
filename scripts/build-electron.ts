import { execFileSync } from "node:child_process";
import fs, { rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function run(cmd: string, args: string[] = [], cwd = REPO_ROOT) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    stdio: "inherit",
    cwd,
  });
}

try {
  console.log("Cleaning up output directory...");
  rmSync(join(REPO_ROOT, "out-build"), { recursive: true, force: true });
  mkdirSync(join(REPO_ROOT, "out-build"), { recursive: true });

  console.log("Building UI renderer and main...");
  try {
    run("pnpm", ["exec", "tsc"]);
  } catch {
    console.log("Type checking failed, continuing anyway...");
  }
  run("pnpm", ["exec", "vite", "build"]);

  console.log("Checking for build artifacts...");
  if (!fs.existsSync(join(REPO_ROOT, "dist"))) {
    throw new Error(
      `Build failed: 'dist' directory not found at ${join(REPO_ROOT, "dist")}`,
    );
  }
  if (!fs.existsSync(join(REPO_ROOT, "dist-electron"))) {
    throw new Error(
      `Build failed: 'dist-electron' directory not found at ${join(REPO_ROOT, "dist-electron")}`,
    );
  }

  console.log("Deploying production dependencies to out-build...");
  // pnpm deploy creates out-build/package.json and out-build/node_modules
  run("pnpm", ["deploy", "--filter", "@nexiq/ui", "--legacy", "out-build"]);

  console.log("Copying build artifacts and config...");
  cpSync(join(REPO_ROOT, "dist"), join(REPO_ROOT, "out-build", "dist"), {
    recursive: true,
  });
  cpSync(
    join(REPO_ROOT, "dist-electron"),
    join(REPO_ROOT, "out-build", "dist-electron"),
    { recursive: true },
  );
  cpSync(
    join(REPO_ROOT, "electron-builder.json5"),
    join(REPO_ROOT, "out-build", "electron-builder.json5"),
  );
  // package.json is already created by pnpm deploy

  console.log("Checking for backend CLI in sibling directory...");
  const backendCliDist = join(
    REPO_ROOT,
    "..",
    "nexiq",
    "packages",
    "cli",
    "dist",
  );
  if (fs.existsSync(backendCliDist)) {
    console.log("Found backend CLI, copying to out-build/bin...");
    mkdirSync(join(REPO_ROOT, "out-build", "bin"), { recursive: true });
    // Copy the dist content
    cpSync(backendCliDist, join(REPO_ROOT, "out-build", "bin"), {
      recursive: true,
    });
    // Rename cli.js to nexiq (or nexiq.exe on windows)
    const isWindows = process.platform === "win32";
    const cliJsPath = join(REPO_ROOT, "out-build", "bin", "cli.js");
    if (fs.existsSync(cliJsPath)) {
      const targetPath = join(
        REPO_ROOT,
        "out-build",
        "bin",
        isWindows ? "nexiq.exe" : "nexiq",
      );
      fs.renameSync(cliJsPath, targetPath);
      fs.chmodSync(targetPath, "755");
      console.log(`Copied and renamed backend CLI to ${targetPath}`);
    }
  } else {
    console.warn(
      "Backend CLI not found in sibling directory, build might rely on global installation.",
    );
  }

  console.log("Running electron-builder...");
  const builderArgs = process.argv.slice(2);
  run(
    "pnpm",
    ["exec", "electron-builder", "build", ...builderArgs],
    join(REPO_ROOT, "out-build"),
  );
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
