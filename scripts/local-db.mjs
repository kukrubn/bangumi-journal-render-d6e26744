import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cfg = new URL("../.journal-local/database.json", import.meta.url);
if (!process.env.VERCEL && process.platform === "win32" && fs.existsSync(cfg)) {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    fileURLToPath(new URL("local-db.ps1", import.meta.url)),
  ];
  if (process.argv.includes("--stop")) args.push("-Stop");
  const result = spawnSync("powershell.exe", args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
