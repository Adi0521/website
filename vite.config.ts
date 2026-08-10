import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  // `#include "common/wave.glsl";` resolves relative to the importing shader.
  // The wave chunk MUST stay a single shared file: the simulation and the
  // renderer both include it, and if they ever compute different waterlines
  // you get foam that erases nothing over dark sand with no water on it.
  plugins: [glsl({ include: ["**/*.glsl", "**/*.vert", "**/*.frag"], compress: false })],
  server: { port: 5273 }
});
