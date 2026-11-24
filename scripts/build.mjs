import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
const stage = await mkdtemp(path.join(root, ".stage-"));
try {
  for (const entry of ["index.html", "admin.html", "household.html", "src", "assets", "sw.js", "manifest.webmanifest"]) {
    await cp(path.join(root, entry), path.join(stage, entry), {
      recursive: true,
    });
  }
  const hash = createHash("sha256");
  const files = await readdir(stage, { recursive: true, withFileTypes: true });
  for (const file of files
    .filter((file) => file.isFile())
    .map((file) => path.join(file.parentPath, file.name))
    .sort()) {
    hash.update(await readFile(file));
  }
  const worker = path.join(stage, "sw.js");
  const original = await readFile(worker, "utf8");
  await writeFile(
    worker,
    original.replace("__BUILD__", hash.digest("hex").slice(0, 16)),
  );
  await mkdir(output, { recursive: true });
  await rm(output, { recursive: true });
  await rename(stage, output);
  console.log(
    "TerraSense production files are ready in dist/. Vercel serves api/ separately.",
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
