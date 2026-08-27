// The package is "type": "module", so Node resolves its relative imports strictly: an
// extensionless specifier like "./replay" is a hard ERR_MODULE_NOT_FOUND, not a warning.
// tsc emits specifiers verbatim, so source written without extensions produced a package
// that could not be imported by Node at all — which breaks any SSR framework at BUILD
// time (next build dies collecting page data), not merely at runtime. That shipped in
// 0.11.6 and is why this check runs as part of `build`, ahead of publish.
//
// Both entry points are checked. ./react imports the main entry, so it fails
// independently — and it is the one a bundle-everything fix would have quietly broken by
// giving the two entries separate copies of the Monoscope class.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const entries = ["dist/index.js", "dist/react.js"];
let failed = false;

for (const entry of entries) {
  try {
    await import(pathToFileURL(resolve(entry)).href);
    console.log(`  ok   ${entry}`);
  } catch (e) {
    failed = true;
    console.error(`  FAIL ${entry}: ${e.message}`);
  }
}

if (failed) {
  console.error(
    "\nThe built package cannot be imported by Node.\n" +
      "Relative specifiers in src/ need explicit .js extensions (tsc passes them through verbatim)."
  );
  process.exit(1);
}
console.log("ESM entry points are importable by Node.");
