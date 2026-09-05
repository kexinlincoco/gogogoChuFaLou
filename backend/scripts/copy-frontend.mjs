// Post-build step, run after `tsc` as part of `npm run build`:
//  1. tsc only compiles .ts -> .js and never copies non-TS files, so
//     src/db/schema.sql has to be copied into dist/db/ by hand or
//     db/client.ts's readFileSync at startup 404s — this was a real,
//     previously-undiscovered bug (only surfaced once someone actually ran
//     `npm run build && node dist/index.js` instead of `npm run dev`, since
//     tsx runs straight from src/ where the .sql file already sits next to
//     client.ts).
//  2. Copies the built frontend (frontend/dist) into backend/dist/public so
//     the compiled server can serve it as static files in production — see
//     index.ts's NODE_ENV === "production" branch.
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

// 1. schema.sql
const schemaSrc = path.join(backendRoot, "src", "db", "schema.sql");
const schemaDest = path.join(backendRoot, "dist", "db", "schema.sql");
cpSync(schemaSrc, schemaDest);
console.log(`✓ copied schema.sql → ${schemaDest}`);

// 2. frontend build (optional — only present when deploying the unified
// single-service setup; `npm run build:server-only` skips this file entirely)
const frontendSrc = path.join(backendRoot, "..", "frontend", "dist");
const frontendDest = path.join(backendRoot, "dist", "public");
if (existsSync(frontendSrc)) {
  rmSync(frontendDest, { recursive: true, force: true });
  cpSync(frontendSrc, frontendDest, { recursive: true });
  console.log(`✓ copied frontend build → ${frontendDest}`);
} else {
  console.log(`… ${frontendSrc} not found, skipping (build the frontend first if you want the unified deploy)`);
}
