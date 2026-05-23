/**
 * Configuración centralizada del servidor MCP.
 * Lee variables de entorno definidas en claude_desktop_config.json o en .env.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProjectPath() {
   const raw = process.env.VFP_PROJECT_PATH;
   if (!raw || raw.trim() === "") {
      return null;
   }
   return path.resolve(raw);
}

function parseBool(value, defaultValue) {
   if (value === undefined || value === null || value === "") return defaultValue;
   const v = String(value).toLowerCase().trim();
   return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const config = {
   projectPath: resolveProjectPath(),

   // Carpeta donde se guardan backups antes de sobreescribir archivos
   backupsDir: process.env.VFP_BACKUPS_DIR
      ? path.resolve(process.env.VFP_BACKUPS_DIR)
      : null,

   // Log de auditoría (todas las escrituras quedan registradas)
   logsDir: process.env.VFP_LOGS_DIR
      ? path.resolve(process.env.VFP_LOGS_DIR)
      : null,

   // Encoding por defecto de los .prg (lo habitual en VFP es CP1252)
   defaultEncoding: process.env.VFP_ENCODING || "cp1252",

   // Permitir escritura de archivos .prg desde el MCP
   allowWrite: parseBool(process.env.VFP_ALLOW_WRITE, true),

   // Tamaño máximo de archivo que se puede leer (bytes)
   maxFileSize: Number(process.env.VFP_MAX_FILE_SIZE || 5 * 1024 * 1024),

   // Límite de resultados para búsquedas
   maxSearchResults: Number(process.env.VFP_MAX_SEARCH_RESULTS || 500),

   // Límite de filas en queries DBF
   maxQueryRows: Number(process.env.VFP_MAX_QUERY_ROWS || 1000),
};

/**
 * Valida que la configuración mínima está presente. Lanza error si no.
 * No se llama automáticamente: cada herramienta valida lo que necesita.
 */
export function requireProjectPath() {
   if (!config.projectPath) {
      throw new Error(
         "VFP_PROJECT_PATH no está definido. Configúrelo en claude_desktop_config.json"
      );
   }
   if (!fs.existsSync(config.projectPath)) {
      throw new Error(
         `La ruta del proyecto no existe: ${config.projectPath}`
      );
   }
   return config.projectPath;
}

/**
 * Resuelve una ruta relativa al projectPath. Bloquea path traversal fuera del proyecto.
 */
export function resolveSafe(relativeOrAbsolutePath) {
   const projectPath = requireProjectPath();
   const resolved = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : path.resolve(projectPath, relativeOrAbsolutePath);

   const normalizedProject = path.resolve(projectPath) + path.sep;
   const normalizedResolved = resolved + path.sep;

   if (!normalizedResolved.startsWith(normalizedProject) && resolved !== path.resolve(projectPath)) {
      throw new Error(
         `Ruta fuera del proyecto: ${relativeOrAbsolutePath}`
      );
   }
   return resolved;
}

export function getBackupsDir() {
   if (config.backupsDir) return config.backupsDir;
   return path.join(requireProjectPath(), ".mcp_backups");
}

export function getLogsDir() {
   if (config.logsDir) return config.logsDir;
   return path.join(requireProjectPath(), ".mcp_logs");
}

export { __dirname as moduleDir };
