/**
 * Fase 6 — Herramientas avanzadas de productividad:
 *  - rename_procedure   Renombra PROCEDURE/FUNCTION en todos los archivos
 *  - find_dead_code     Detecta funciones definidas pero nunca llamadas
 *  - generate_docs      Genera documentación Markdown desde comentarios PRG
 *  - git_log            Historial git del proyecto o de un archivo
 *  - git_diff           Diff git de cambios pendientes o de un commit
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config, requireProjectPath, resolveSafe } from "../config.js";
import { backupFile } from "../utils/backup.js";
import { decode, encode, detectEncoding } from "../utils/encoding.js";
import { parsePrg, findCalls } from "../utils/foxpro_parser.js";
import { logAudit } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers compartidos
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".prg", ".spr", ".mpr", ".qpr", ".h"];
const EXCLUDE_DIRS = new Set([".mcp_backups", ".mcp_logs", "node_modules", ".git", "foxpro-mcp"]);

function walkPrg(rootDir) {
   const results = [];
   const stack = [rootDir];
   while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
         const full = path.join(dir, e.name);
         if (e.isDirectory()) {
            if (!EXCLUDE_DIRS.has(e.name)) stack.push(full);
         } else if (SOURCE_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
            results.push(full);
         }
      }
   }
   return results;
}

function readSource(absPath) {
   const buf = fs.readFileSync(absPath);
   const enc = detectEncoding(buf) || config.defaultEncoding;
   return { content: decode(buf, enc), enc };
}

function escapeRegex(s) {
   return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Promisifica execFile
function gitExec(args, cwd, timeoutMs = 15_000) {
   return new Promise((resolve, reject) => {
      execFile("git", args, { cwd, timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
         if (err && !stdout) {
            reject(new Error(stderr || err.message));
         } else {
            resolve({ stdout: (stdout || "").trim(), stderr: (stderr || "").trim() });
         }
      });
   });
}

// ---------------------------------------------------------------------------
// rename_procedure
// ---------------------------------------------------------------------------
export const rename_procedure = {
   name: "rename_procedure",
   title: "Renombrar procedimiento/función",
   description:
      "Renombra un PROCEDURE o FUNCTION en todos los archivos .prg del proyecto: " +
      "actualiza la definición y todas las llamadas (DO <nombre> y <nombre>(...)). " +
      "Hace backup automático de cada archivo modificado. Soporta modo dryRun.",
   inputSchema: {
      type: "object",
      required: ["oldName", "newName"],
      properties: {
         oldName: {
            type: "string",
            description: "Nombre actual del procedimiento o función (case-insensitive).",
         },
         newName: {
            type: "string",
            description: "Nuevo nombre.",
         },
         dryRun: {
            type: "boolean",
            description: "Si true, solo reporta qué cambiaría sin modificar archivos. Default false.",
         },
         subdirectory: {
            type: "string",
            description: "Limitar la búsqueda a un subdirectorio del proyecto.",
         },
      },
   },
   async run({ oldName, newName, dryRun, subdirectory }) {
      if (!oldName || !newName) throw new Error("oldName y newName son obligatorios.");
      if (oldName.toLowerCase() === newName.toLowerCase()) {
         throw new Error("oldName y newName son iguales (ignorando mayúsculas).");
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
         throw new Error(`newName '${newName}' no es un identificador VFP válido.`);
      }

      const projectPath = requireProjectPath();
      const baseDir = subdirectory ? resolveSafe(subdirectory) : projectPath;
      const files = walkPrg(baseDir);

      // Regex para definición: PROCEDURE|FUNCTION <oldName>
      const reDefn = new RegExp(
         `(\\b(?:PROCEDURE|FUNCTION)\\s+)${escapeRegex(oldName)}(\\b)`,
         "gi"
      );
      // Regex para llamadas: DO <oldName> o <oldName>(
      const reCall = new RegExp(
         `(\\bDO\\s+)${escapeRegex(oldName)}(\\b)|(\\b)${escapeRegex(oldName)}(\\s*\\()`,
         "gi"
      );

      const report = [];
      let totalFiles = 0;
      let totalReplacements = 0;

      for (const absPath of files) {
         const { content, enc } = readSource(absPath);

         // Contar ocurrencias
         let count = 0;
         reDefn.lastIndex = 0;
         reCall.lastIndex = 0;
         let m;
         while ((m = reDefn.exec(content)) !== null) { count++; reDefn.lastIndex = m.index + 1; }
         while ((m = reCall.exec(content)) !== null) { count++; reCall.lastIndex = m.index + 1; }

         if (count === 0) continue;

         totalFiles++;
         totalReplacements += count;
         const rel = path.relative(projectPath, absPath).replace(/\\/g, "/");
         report.push({ file: rel, replacements: count });

         if (!dryRun) {
            if (!config.allowWrite) {
               throw new Error("Escritura deshabilitada (VFP_ALLOW_WRITE=false).");
            }
            backupFile(absPath);

            // Aplicar sustituciones preservando case del prefijo
            reDefn.lastIndex = 0;
            reCall.lastIndex = 0;
            const newContent = content
               .replace(reDefn, `$1${newName}$2`)
               .replace(reCall, (full, p1, p2, p3, p4) => {
                  if (p1 !== undefined) return `${p1}${newName}${p2}`;   // DO <name>
                  return `${p3}${newName}${p4}`;                          // <name>(
               });

            const eol = content.includes("\r\n") ? "\r\n" : "\n";
            const normalized = newContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
               .replace(/\n/g, eol);
            fs.writeFileSync(absPath, encode(normalized, enc));
         }
      }

      if (!dryRun && totalFiles > 0) {
         logAudit("RENAME_PROC", { oldName, newName, files: totalFiles, replacements: totalReplacements });
      }

      return {
         oldName,
         newName,
         dryRun: !!dryRun,
         filesChanged: totalFiles,
         totalReplacements,
         changes: report,
      };
   },
};

// ---------------------------------------------------------------------------
// find_dead_code
// ---------------------------------------------------------------------------
export const find_dead_code = {
   name: "find_dead_code",
   title: "Detectar código muerto",
   description:
      "Detecta PROCEDUREs y FUNCTIONs que están definidos en el proyecto pero " +
      "no tienen ninguna llamada (DO <nombre> ni <nombre>()) en ningún archivo. " +
      "Ignora el programa principal implícito (primer bloque sin nombre) y " +
      "los procedimientos que empiezan por '_' (convención privada en VFP).",
   inputSchema: {
      type: "object",
      properties: {
         subdirectory: {
            type: "string",
            description: "Limitar análisis a un subdirectorio del proyecto.",
         },
         includePrivate: {
            type: "boolean",
            description: "Incluir procedimientos que empiezan por '_'. Default false.",
         },
      },
   },
   async run({ subdirectory, includePrivate }) {
      const projectPath = requireProjectPath();
      const baseDir = subdirectory ? resolveSafe(subdirectory) : projectPath;
      const files = walkPrg(baseDir);

      // Paso 1: recopilar todas las definiciones
      const definitions = new Map(); // name.toUpperCase() → { name, file, line, kind }

      for (const absPath of files) {
         const { content } = readSource(absPath);
         const parsed = parsePrg(content);
         const rel = path.relative(projectPath, absPath).replace(/\\/g, "/");

         for (const p of parsed.procedures) {
            const key = p.name.toUpperCase();
            if (!includePrivate && p.name.startsWith("_")) continue;
            if (!definitions.has(key)) {
               definitions.set(key, { name: p.name, file: rel, line: p.startLine, kind: p.kind });
            }
         }
         for (const cls of parsed.classes) {
            for (const m of cls.methods) {
               // Los métodos de clase rara vez se llaman con DO, no los marcamos como muertos
               // a menos que sean EVENT handlers obvios
            }
         }
      }

      // Paso 2: buscar llamadas a cada definición en todos los archivos
      const allContent = files.map((absPath) => {
         try { return readSource(absPath).content; } catch { return ""; }
      }).join("\n");

      const dead = [];
      for (const [key, def] of definitions) {
         const calls = findCalls(allContent, def.name);
         // findCalls también detecta la línea de definición como posible "llamada";
         // la definición en sí genera un match con la regex de llamada si el nombre
         // aparece seguido de "(". Restamos 1 si la firma incluye paréntesis.
         const callCount = calls.length;
         if (callCount === 0) {
            dead.push(def);
         }
      }

      dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

      return {
         analyzed: files.length,
         defined: definitions.size,
         deadCount: dead.length,
         dead,
      };
   },
};

// ---------------------------------------------------------------------------
// generate_docs
// ---------------------------------------------------------------------------
export const generate_docs = {
   name: "generate_docs",
   title: "Generar documentación Markdown",
   description:
      "Extrae todos los PROCEDUREs, FUNCTIONs y DEFINE CLASS de los archivos .prg " +
      "junto a sus comentarios de cabecera y los formatea como documentación Markdown. " +
      "Puede escribir el resultado a un archivo o devolverlo como string.",
   inputSchema: {
      type: "object",
      properties: {
         file: {
            type: "string",
            description:
               "Ruta relativa a un .prg concreto. Si se omite, documenta todo el proyecto.",
         },
         outputFile: {
            type: "string",
            description:
               "Ruta relativa donde escribir el .md resultante. Si se omite, devuelve el contenido.",
         },
         includePrivate: {
            type: "boolean",
            description: "Incluir procedimientos que empiezan por '_'. Default false.",
         },
      },
   },
   async run({ file, outputFile, includePrivate }) {
      const projectPath = requireProjectPath();
      let files;

      if (file) {
         const abs = resolveSafe(file);
         if (!fs.existsSync(abs)) throw new Error(`Archivo no encontrado: ${file}`);
         files = [abs];
      } else {
         files = walkPrg(projectPath);
      }

      const sections = [];

      for (const absPath of files) {
         const rel = path.relative(projectPath, absPath).replace(/\\/g, "/");
         const { content } = readSource(absPath);
         const parsed = parsePrg(content);

         const procs = parsed.procedures.filter(
            (p) => includePrivate || !p.name.startsWith("_")
         );
         const classes = parsed.classes;

         if (procs.length === 0 && classes.length === 0) continue;

         const lines = [`## \`${rel}\``];

         for (const p of procs) {
            const sig = p.parameters.length > 0
               ? `${p.name}(${p.parameters.join(", ")})`
               : p.name;
            lines.push(`\n### ${p.kind === "FUNCTION" ? "🔧" : "📌"} \`${sig}\``);
            lines.push(`*Línea ${p.startLine}–${p.endLine ?? "?"}*`);
            if (p.comment) lines.push(`\n${p.comment}`);
         }

         for (const cls of classes) {
            lines.push(`\n### 🏛️ DEFINE CLASS \`${cls.name}\`${cls.baseClass ? ` AS ${cls.baseClass}` : ""}`);
            lines.push(`*Línea ${cls.startLine}–${cls.endLine ?? "?"}* | ${cls.methods.length} método(s)`);
            if (cls.comment) lines.push(`\n${cls.comment}`);

            for (const m of cls.methods) {
               const sig = m.parameters.length > 0
                  ? `${m.name}(${m.parameters.join(", ")})`
                  : m.name;
               lines.push(`\n#### ${m.kind === "FUNCTION" ? "🔧" : "📌"} \`${sig}\``);
               lines.push(`*Línea ${m.startLine}–${m.endLine ?? "?"}*`);
               if (m.comment) lines.push(`\n${m.comment}`);
            }
         }

         sections.push(lines.join("\n"));
      }

      const title = file
         ? `# Documentación: ${file}`
         : `# Documentación del proyecto FoxPro\n\n*Generado automáticamente por JurassicFox MCP*`;

      const markdown = [title, "", ...sections].join("\n\n");

      if (outputFile) {
         if (!config.allowWrite) {
            throw new Error("Escritura deshabilitada (VFP_ALLOW_WRITE=false).");
         }
         const absOut = resolveSafe(outputFile);
         const dir = path.dirname(absOut);
         if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
         fs.writeFileSync(absOut, markdown, "utf8");
         logAudit("GENERATE_DOCS", { outputFile, sections: sections.length });
         return {
            outputFile,
            sections: sections.length,
            bytes: Buffer.byteLength(markdown, "utf8"),
         };
      }

      return {
         sections: sections.length,
         markdown,
      };
   },
};

// ---------------------------------------------------------------------------
// git_log
// ---------------------------------------------------------------------------
export const git_log = {
   name: "git_log",
   title: "Historial Git del proyecto",
   description:
      "Devuelve el historial de commits git del proyecto FoxPro (o de un archivo concreto). " +
      "Requiere que el directorio del proyecto esté bajo control de versiones con Git.",
   inputSchema: {
      type: "object",
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa a un archivo para ver solo sus commits.",
         },
         limit: {
            type: "number",
            description: "Número máximo de commits a devolver. Default 30.",
         },
         format: {
            type: "string",
            enum: ["short", "medium", "oneline"],
            description: "Nivel de detalle. Default 'medium'.",
         },
      },
   },
   async run({ file, limit, format }) {
      const projectPath = requireProjectPath();
      const n = Math.min(limit ?? 30, 200);

      const prettyMap = {
         oneline: "%h %s (%an, %ar)",
         short: "%h %s%n  %an <%ae>  %ar",
         medium: "%H%n%an <%ae>%n%ad%n%n    %s%n%n%b",
      };
      const fmt = prettyMap[format] || prettyMap.medium;

      const args = [
         "log",
         `--pretty=format:${fmt}`,
         `--date=short`,
         `-n`, String(n),
      ];

      if (file) {
         const absFile = resolveSafe(file);
         args.push("--", absFile);
      }

      let result;
      try {
         result = await gitExec(args, projectPath);
      } catch (err) {
         throw new Error(`git log falló: ${err.message}. ¿Está el proyecto bajo Git?`);
      }

      return {
         file: file || null,
         limit: n,
         format: format || "medium",
         log: result.stdout || "(sin commits)",
      };
   },
};

// ---------------------------------------------------------------------------
// git_diff
// ---------------------------------------------------------------------------
export const git_diff = {
   name: "git_diff",
   title: "Diff Git de cambios",
   description:
      "Muestra los cambios git pendientes (working tree vs HEAD) o de un commit concreto " +
      "sobre archivos del proyecto FoxPro. Filtra por archivo si se especifica.",
   inputSchema: {
      type: "object",
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa a un archivo para ver solo su diff.",
         },
         staged: {
            type: "boolean",
            description: "Si true, muestra cambios en el índice (staged). Default false (working tree).",
         },
         commit: {
            type: "string",
            description:
               "Hash de commit para ver los cambios de ese commit concreto. " +
               "Si se especifica, ignora staged.",
         },
         contextLines: {
            type: "number",
            description: "Líneas de contexto alrededor de cada cambio. Default 3.",
         },
      },
   },
   async run({ file, staged, commit, contextLines }) {
      const projectPath = requireProjectPath();
      const ctx = contextLines ?? 3;

      let args;
      if (commit) {
         args = ["show", commit, `--unified=${ctx}`, "--stat"];
      } else {
         args = ["diff", `--unified=${ctx}`];
         if (staged) args.push("--cached");
      }

      if (file) {
         const absFile = resolveSafe(file);
         if (!commit) args.push("--");
         args.push(absFile);
      }

      let result;
      try {
         result = await gitExec(args, projectPath, 20_000);
      } catch (err) {
         throw new Error(`git diff falló: ${err.message}. ¿Está el proyecto bajo Git?`);
      }

      const diff = result.stdout;
      return {
         file: file || null,
         staged: !!staged,
         commit: commit || null,
         empty: !diff,
         diff: diff || "(sin cambios)",
      };
   },
};

export const advancedTools = [
   rename_procedure,
   find_dead_code,
   generate_docs,
   git_log,
   git_diff,
];
