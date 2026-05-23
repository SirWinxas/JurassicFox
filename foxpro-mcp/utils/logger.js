/**
 * Logger simple por archivo con auditoría de operaciones.
 * Las escrituras en archivos .prg dejan rastro en mcp-audit.log con timestamp.
 */

import fs from "node:fs";
import path from "node:path";
import { getLogsDir } from "../config.js";

function ensureLogsDir() {
   const dir = getLogsDir();
   if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
   }
   return dir;
}

function timestamp() {
   return new Date().toISOString();
}

function writeLine(filename, line) {
   try {
      const dir = ensureLogsDir();
      fs.appendFileSync(path.join(dir, filename), `${timestamp()}  ${line}\n`, "utf8");
   } catch (err) {
      // No queremos que un fallo de log rompa el servidor; lo mandamos a stderr.
      process.stderr.write(`[logger] ${err.message}\n`);
   }
}

export function logAudit(action, details) {
   const detailStr = typeof details === "string" ? details : JSON.stringify(details);
   writeLine("mcp-audit.log", `${action}  ${detailStr}`);
}

export function logError(context, err) {
   const msg = err && err.stack ? err.stack : String(err);
   writeLine("mcp-errors.log", `[${context}] ${msg}`);
}

export function logInfo(message) {
   writeLine("mcp.log", message);
}

// Los logs MCP del propio servidor van a stderr (stdout está reservado al protocolo)
export function stderr(...args) {
   process.stderr.write(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ") + "\n");
}
