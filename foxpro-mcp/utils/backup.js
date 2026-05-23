/**
 * Sistema de backup automático antes de sobreescribir archivos.
 * Los backups se guardan en .mcp_backups/<nombre>.<timestamp>.bak
 * También se registra cada backup en el log de auditoría y en manifest.jsonl.
 */

import fs from "node:fs";
import path from "node:path";
import { getBackupsDir, requireProjectPath } from "../config.js";
import { logAudit } from "./logger.js";

function timestampForFilename() {
   const d = new Date();
   const pad = (n) => String(n).padStart(2, "0");
   return (
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
   );
}

function ensureBackupsDir() {
   const dir = getBackupsDir();
   if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
   }
   return dir;
}

function appendToManifest(entry) {
   try {
      const dir = ensureBackupsDir();
      fs.appendFileSync(
         path.join(dir, "manifest.jsonl"),
         JSON.stringify(entry) + "\n",
         "utf8"
      );
   } catch { /* no-fatal: el audit log ya tiene el registro */ }
}

export function getManifestPath() {
   return path.join(getBackupsDir(), "manifest.jsonl");
}

/**
 * Escribe buffer a absPath de forma atómica.
 * Escribe primero a un temporal en el mismo directorio, luego lo renombra.
 * Si falla, elimina el temporal y relanza el error.
 */
export function atomicWrite(absPath, buffer) {
   const tmpPath = `${absPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
   try {
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, absPath);
   } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignorar */ }
      throw err;
   }
}

/**
 * Crea un backup de absolutePath si el archivo existe.
 * Retorna la ruta del backup creado, o null si el archivo no existía.
 * Preserva la subruta relativa al proyecto: foo/bar.prg -> .mcp_backups/foo/bar.prg.20260515-104530.bak
 */
export function backupFile(absolutePath, { tool = null, reason = "overwrite" } = {}) {
   if (!fs.existsSync(absolutePath)) return null;

   const projectPath = requireProjectPath();
   const backupsDir = ensureBackupsDir();
   const relPath = path.relative(projectPath, absolutePath);
   const ts = timestampForFilename();

   const backupRelDir = path.dirname(relPath);
   const backupFilename = `${path.basename(relPath)}.${ts}.bak`;
   const targetDir = path.join(backupsDir, backupRelDir);
   if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
   }

   const backupPath = path.join(targetDir, backupFilename);
   fs.copyFileSync(absolutePath, backupPath);

   const originalRel = relPath.replace(/\\/g, "/");
   const backupRel = path.relative(projectPath, backupPath).replace(/\\/g, "/");

   logAudit("BACKUP", { original: originalRel, backup: backupRel });
   appendToManifest({
      timestamp: new Date().toISOString(),
      original: originalRel,
      backup: backupRel,
      tool,
      reason,
   });

   return backupPath;
}
