import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import json from "@rollup/plugin-json";

export default {
  input: "src/index.ts",
  output: [
    {
      file: "dist/monoscope.umd.js",
      format: "umd",
      name: "Monoscope",
      sourcemap: true,
      plugins: [terser()],
    },
    {
      file: "dist/monoscope.min.js",
      format: "iife",
      name: "Monoscope",
      sourcemap: true,
      plugins: [terser()],
    },
  ],
  plugins: [
    json(),
    resolve({ browser: true }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: true,
      declarationDir: "dist",
      rootDir: "src",
    }),
  ],
};
