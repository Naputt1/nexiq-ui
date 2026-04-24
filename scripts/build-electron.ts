import { execSync } from "node:child_process";
import fs, { rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function run(command: string, cwd = REPO_ROOT) {
  console.log(`> ${command}`);
  execSync(command, { stdio: "inherit", cwd, shell: true });
}

try {
  console.log("Cleaning up output directory...");
  rmSync(join(REPO_ROOT, "out-build"), { recursive: true, force: true });
  mkdirSync(join(REPO_ROOT, "out-build"), { recursive: true });

  console.log("Building UI renderer and main...");
  try {
    run("pnpm exec tsc");
  } catch (error) {
    console.log("Type checking failed, continuing anyway...");
  }
  run("pnpm exec vite build");

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
  run(
    `pnpm deploy --filter @nexiq/ui --legacy "${join(REPO_ROOT, "out-build")}"`,
  );

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
  cpSync(
    join(REPO_ROOT, "package.json"),
    join(REPO_ROOT, "out-build", "package.json"),
  );

  console.log("Running electron-builder...");
  const args = process.argv.slice(2).join(" ");
  run(`pnpm exec electron-builder ${args}`, join(REPO_ROOT, "out-build"));
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
