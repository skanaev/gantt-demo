import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const normalizeBasePath = (rawValue: string | undefined): string => {
  if (!rawValue) {
    return "/";
  }

  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: normalizeBasePath(env.VITE_APP_BASE_PATH),
    plugins: [react()],
  };
});
