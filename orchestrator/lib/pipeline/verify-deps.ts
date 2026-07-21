import fs from "fs";
import path from "path";

type DepMap = Record<string, string>;

function readDeps(packageJsonPath: string): { dependencies: DepMap; devDependencies: DepMap } {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
  };
}

/**
 * Fails if the generated app added any dependency beyond what the seed
 * template already had. Codex is not allowed to `npm install` — this checks
 * that mechanically instead of trusting the prompt alone.
 */
export function verifyDeps(appDir: string, seedDir: string): void {
  const seed = readDeps(path.join(seedDir, "package.json"));
  const generated = readDeps(path.join(appDir, "package.json"));

  const added: string[] = [];
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const name of Object.keys(generated[section])) {
      if (!(name in seed[section])) {
        added.push(`${section}.${name}`);
      }
    }
  }

  if (added.length > 0) {
    throw new Error(
      `Generated app added dependencies not in the seed template: ${added.join(", ")}. ` +
        `Codex may not run npm install or edit package.json.`
    );
  }
}
