import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  if (command === "build" && mode === "demo")
    throw new Error(
      "Demo is development-only; production builds cannot enable fixtures.",
    );
  return {
    define: {
      __DEMO__: JSON.stringify(command === "serve" && mode === "demo"),
    },
    server: { strictPort: true },
  };
});
