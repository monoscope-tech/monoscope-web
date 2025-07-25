import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import json from "@rollup/plugin-json";

export default {
  input: "src/index.ts",
  output: [
    {
      file: "dist/monoscopetech-browser.esm.js",
      format: "esm",
      sourcemap: true,
    },
    {
      file: "dist/monoscopetech-browser.cjs.js",
      format: "cjs",
      sourcemap: true,
    },
    {
      file: "dist/monoscopetech-browser.umd.js",
      format: "umd",
      name: "@monoscopetech/browser",
      sourcemap: true,
      plugins: [terser()],
    },
  ],
  plugins: [
    json(),
    resolve(),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: true,
      declarationDir: "dist",
      rootDir: "src",
    }),
  ],
};
