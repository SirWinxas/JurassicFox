/**
 * Sistema de backup autom tico antes de sobreescribir archivos.
 * Los backups se guardan en .mcp_backups/<nombre>.<timestamp>.bak
 * Tambi n se registra cada backup en el log de auditor a.
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

/**
 * Crea un backup de absolutePath si el archivo existe.
 * Retorna la ruta del backup creado, o null si el archivo no exist a.
 * Preserva la subruta relativa al proyecto: foo/bar.prg -> foo/bar.prg.20260515-104530.bak
 */
export function backupFile(absolutePath) {
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

   logAudit("BACKUP", { original: relPath, backup: path.relative(projectPath, backupPath) });
   return backupPath;
}
