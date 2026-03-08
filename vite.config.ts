import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { devAgentPlugin } from "./server/dev-agent-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
          dest: "vad/",
        },
        {
          src: "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
          dest: "vad/",
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: "vad/",
        },
        {
          src: "node_modules/onnxruntime-web/dist/*.mjs",
          dest: "vad/",
        },
      ],
    }),
    devAgentPlugin(),
  ],
});
