import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devAgentPlugin } from "./server/dev-agent-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), devAgentPlugin()],
});
