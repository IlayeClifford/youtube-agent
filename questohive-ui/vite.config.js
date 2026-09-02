import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // Exposes Vite to your local network and tunnels
    allowedHosts: [".loca.lt", "localhost"],
    hmr: {
      clientPort: 443, // Forces Vite's internal development socket to use safe paths over tunnels
    }
  },
});
