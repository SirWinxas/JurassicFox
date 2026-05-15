/**
 * Herramientas MCP para manipular el c digo fuente del proyecto FoxPro:
 *  - list_prg_files
 *  - read_prg
 *  - write_prg
 *  - search_in_code
 *  - get_procedures
 *  - get_project_tree
 */

import fs from "node:fs";
import path from "node:path";
import { config, requireProjectPath, resolveSafe } from "../config.js";
import { backupFile } from "../utils/backup.js";
import { decode, encode, detectEncoding } from "../utils/encoding.js";
import { parsePrg } from "../utils/foxpro_parser.js";
import { readDbfRecords } from "../utils/dbf_reader.js";
import { logAudit } from "../utils/logger.js";

// Extensiones FoxPro relevantes para c digo fuente
const SOURCE_EXTENSIONS = [".prg", ".spr", ".mpr", ".qpr", ".h"];
const FORM_LIBRARY_EXTENSIONS = [".scx", ".vcx", ".frx", ".lbx", ".mnx"]; // son DBFs por debajo
const ALL_CODE_EXTENSIONS = [...SOURCE_EXTENSIONS, ...FORM_LIBRARY_EXTENSIONS];

const EXCLUDE_DIRS = new Set([".mcp_backups", ".mcp_logs", "node_modules", ".git", "foxpro-mcp"]);

function isText(ext) {
   return SOURCE_EXTENSIONS.includes(ext.toLowerCase());
}

function walkProject(rootDir, extensions, maxResults = Infinity) {
   const results = [];
   const stack = [rootDir];
   const extLower = extensions.map((e) => e.toLowerCase());

   while (stack.length > 0 && results.length < maxResults) {
      const dir = stack.pop();
      let entries;
      try {
         entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
         continue;
      }
      for (const entry of entries) {
         if (results.length >= maxResults) break;
         const full = path.join(dir, entry.name);
         if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue;
            stack.push(full);
         } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extLower.length === 0 || extLower.includes(ext)) {
               results.push(full);
            }
         }
      }
   }
   return results;
}

// ---------------------------------------------------------------------------
// list_prg_files
// ---------------------------------------------------------------------------
export const list_prg_files = {
   name: "list_prg_files",
   title: "Listar archivos de c digo FoxPro",
   description:
      "Lista archivos de c digo fuente del proyecto FoxPro: .prg, .spr, .mpr, .qpr, .h, " +
      ".scx (forms), .vcx (class libraries), .frx (reports), etc. Por defecto incluye todos.",
   inputSchema: {
      type: "object",
      properties: {
         extensions: {
            type: "array",
            items: { type: "string" },
            description:
               "Lista de extensiones a incluir (p.ej. ['.prg', '.scx']). Si se omite, se devuelven todos los formatos de c digo.",
         },
         subdirectory: {
            type: "string",
            description: "Subdirectorio del proyecto al que limitar la b squeda (opcional).",
         },
      },
   },
   async run({ extensions, subdirectory }) {
      const projectPath = requireProjectPath();
      const baseDir = subdirectory ? resolveSafe(subdirectory) : projectPath;
      const exts = Array.isArray(extensions) && extensions.length > 0
         ? extensions.map((e) => (e.startsWith(".") ? e : "." + e))
         : ALL_CODE_EXTENSIONS;

      const files = walkProject(baseDir, exts, 5000);
      const items = files.map((full) => {
         const rel = path.relative(projectPath, full).replace(/\\/g, "/");
         const stat = fs.statSync(full);
         return {
            path: rel,
            size: stat.size,
            modified: stat.mtime.toISOString(),
         };
      });

      items.sort((a, b) => a.path.localeCompare(b.path));
      return {
         baseDir: path.relative(projectPath, baseDir).replace(/\\/g, "/") || ".",
         count: items.length,
         files: items,
      };
   },
};

// ---------------------------------------------------------------------------
// read_prg
// ---------------------------------------------------------------------------
export const read_prg = {
   name: "read_prg",
   title: "Leer archivo de c digo",
   description:
      "Lee el contenido completo de un archivo de c digo FoxPro (.prg, .spr, .mpr, .qpr, .h) " +
      "decodificando el encoding correcto (CP1252 por defecto, configurable).",
   inputSchema: {
      type: "object",
      required: ["file"],
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa al proyecto del archivo a leer.",
         },
         encoding: {
            type: "string",
            description:
               "Encoding a usar. Valores t picos: 'cp1252' (default), 'cp850', 'utf8'. " +
               "Si se omite, se intenta detectar autom ticamente.",
         },
         maxBytes: {
            type: "number",
            description: "L mite de bytes a leer (por defecto: VFP_MAX_FILE_SIZE).",
         },
      },
   },
   async run({ file, encoding, maxBytes }) {
      const absPath = resolveSafe(file);
      if (!fs.existsSync(absPath)) {
         throw new Error(`Archivo no encontrado: ${file}`);
      }
      const stat = fs.statSync(absPath);
      const limit = maxBytes ?? config.maxFileSize;
      if (stat.size > limit) {
         throw new Error(
            `Archivo demasiado grande (${stat.size} bytes > ${limit}). Usa maxBytes para forzar.`
         );
      }

      const ext = path.extname(absPath).toLowerCase();
      if (!isText(ext)) {
         throw new Error(
            `El archivo ${file} no es texto (extensi n ${ext}). ` +
            `Para archivos binarios .scx/.vcx/.frx usa list_prg_files o herramientas DBF.`
         );
      }

      const buffer = fs.readFileSync(absPath);
      const enc = encoding || detectEncoding(buffer) || config.defaultEncoding;
      const content = decode(buffer, enc);
      const lineCount = content.split(/\r?\n/).length;

      return {
         file,
         encoding: enc,
         size: stat.size,
         lines: lineCount,
         modified: stat.mtime.toISOString(),
         content,
      };
   },
};

// ---------------------------------------------------------------------------
// write_prg
// ---------------------------------------------------------------------------
export const write_prg = {
   name: "write_prg",
   title: "Escribir archivo de c digo",
   description:
      "Crea o sobreescribe un archivo de c digo FoxPro. Antes de sobreescribir hace " +
      "backup autom tico en .mcp_backups/. La operaci n queda registrada en el log de auditor a. " +
      "Por defecto codifica en CP1252 con terminaciones CRLF (formato VFP est ndar).",
   inputSchema: {
      type: "object",
      required: ["file", "content"],
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa al proyecto del archivo a escribir.",
         },
         content: {
            type: "string",
            description: "Contenido completo a escribir.",
         },
         encoding: {
            type: "string",
            description: "Encoding de salida. Por defecto 'cp1252'.",
         },
         eol: {
            type: "string",
            enum: ["crlf", "lf"],
            description:
               "Terminadores de l nea. Por defecto 'crlf' (est ndar Windows/VFP).",
         },
         createDirectories: {
            type: "boolean",
            description:
               "Si la carpeta destino no existe, crearla. Por defecto false.",
         },
      },
   },
   async run({ file, content, encoding, eol, createDirectories }) {
      if (!config.allowWrite) {
         throw new Error(
            "Escritura deshabilitada (VFP_ALLOW_WRITE=false). Habil tala para modificar c digo."
         );
      }

      const absPath = resolveSafe(file);
      const ext = path.extname(absPath).toLowerCase();
      if (!isText(ext)) {
         throw new Error(
            `Solo se permite escribir archivos de texto (${SOURCE_EXTENSIONS.join(", ")}). ` +
            `Recibido: ${ext}`
         );
      }

      // Normalizar EOL
      const eolMode = (eol || "crlf").toLowerCase();
      const eolChar = eolMode === "lf" ? "\n" : "\r\n";
      const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, eolChar);

      // Crear directorios si se pide
      const targetDir = path.dirname(absPath);
      if (!fs.existsSync(targetDir)) {
         if (createDirectories) {
            fs.mkdirSync(targetDir, { recursive: true });
         } else {
            throw new Error(
               `Directorio no existe: ${path.relative(requireProjectPath(), targetDir)}. ` +
               `Usa createDirectories: true para crearlo.`
            );
         }
      }

      // Backup si existe
      const existed = fs.existsSync(absPath);
      const backupPath = existed ? backupFile(absPath) : null;

      // Escribir
      const enc = encoding || config.defaultEncoding;
      const buffer = encode(normalized, enc);
      fs.writeFileSync(absPath, buffer);

      logAudit("WRITE", {
         file: path.relative(requireProjectPath(), absPath),
         bytes: buffer.length,
         encoding: enc,
         eol: eolMode,
         existed,
         backup: backupPath ? path.relative(requireProjectPath(), backupPath) : null,
      });

      return {
         file,
         bytes: buffer.length,
         encoding: enc,
         eol: eolMode,
         created: !existed,
         backup: backupPath ? path.relative(requireProjectPath(), backupPath).replace(/\\/g, "/") : null,
      };
   },
};

// ---------------------------------------------------------------------------
// search_in_code
// ---------------------------------------------------------------------------
export const search_in_code = {
   name: "search_in_code",
   title: "Buscar texto en c digo",
   description:
      "Busca un texto o expresi n regular en todos los archivos de c digo del proyecto. " +
      "Por defecto la b squeda es case-insensitive (VFP es case-insensitive).",
   inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
         pattern: {
            type: "string",
            description: "Patr n a buscar (texto literal o regex si regex=true).",
         },
         regex: {
            type: "boolean",
            description: "Tratar pattern como expresi n regular. Default: false.",
         },
         caseSensitive: {
            type: "boolean",
            description: "B squeda sensible a may sculas. Default: false.",
         },
         extensions: {
            type: "array",
            items: { type: "string" },
            description: "Extensiones a incluir. Default: .prg/.spr/.mpr/.qpr/.h",
         },
         subdirectory: {
            type: "string",
            description: "Limitar a un subdirectorio del proyecto.",
         },
         maxResults: {
            type: "number",
            description: "L mite de coincidencias devueltas.",
         },
      },
   },
   async run({ pattern, regex, caseSensitive, extensions, subdirectory, maxResults }) {
      const projectPath = requireProjectPath();
      const baseDir = subdirectory ? resolveSafe(subdirectory) : projectPath;
      const exts = Array.isArray(extensions) && extensions.length > 0
         ? extensions.map((e) => (e.startsWith(".") ? e : "." + e))
         : SOURCE_EXTENSIONS;
      const limit = Math.min(maxResults ?? config.maxSearchResults, 5000);

      let matcher;
      if (regex) {
         matcher = new RegExp(pattern, caseSensitive ? "g" : "gi");
      } else {
         const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
         matcher = new RegExp(escaped, caseSensitive ? "g" : "gi");
      }

      const files = walkProject(baseDir, exts, 5000);
      const results = [];

      for (const full of files) {
         if (results.length >= limit) break;
         let content;
         try {
            const buffer = fs.readFileSync(full);
            content = decode(buffer, detectEncoding(buffer));
         } catch {
            continue;
         }
         const lines = content.split(/\r?\n/);
         for (let i = 0; i < lines.length; i++) {
            if (results.length >= limit) break;
            matcher.lastIndex = 0;
            if (matcher.test(lines[i])) {
               results.push({
                  file: path.relative(projectPath, full).replace(/\\/g, "/"),
                  line: i + 1,
                  text: lines[i].trim().slice(0, 500),
               });
            }
         }
      }

      return {
         pattern,
         regex: !!regex,
         caseSensitive: !!caseSensitive,
         filesScanned: files.length,
         matches: results.length,
         truncated: results.length >= limit,
         results,
      };
   },
};

// ---------------------------------------------------------------------------
// get_procedures
// ---------------------------------------------------------------------------
export const get_procedures = {
   name: "get_procedures",
   title: "Extraer procedimientos y funciones",
   description:
      "Extrae la lista de PROCEDUREs, FUNCTIONs y DEFINE CLASS de un archivo .prg, " +
      "incluyendo l neas inicio/fin, par metros y comentario de cabecera.",
   inputSchema: {
      type: "object",
      required: ["file"],
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa al proyecto del archivo .prg a analizar.",
         },
      },
   },
   async run({ file }) {
      const absPath = resolveSafe(file);
      if (!fs.existsSync(absPath)) {
         throw new Error(`Archivo no encontrado: ${file}`);
      }
      const buffer = fs.readFileSync(absPath);
      const content = decode(buffer, detectEncoding(buffer));
      const parsed = parsePrg(content);

      return {
         file,
         parameters: parsed.parameters,
         procedures: parsed.procedures.map((p) => ({
            kind: p.kind,
            name: p.name,
            parameters: p.parameters,
            startLine: p.startLine,
            endLine: p.endLine,
            comment: p.comment || null,
         })),
         classes: parsed.classes.map((c) => ({
            name: c.name,
            baseClass: c.baseClass,
            startLine: c.startLine,
            endLine: c.endLine,
            methodCount: c.methods.length,
            methods: c.methods.map((m) => ({
               kind: m.kind,
               name: m.name,
               parameters: m.parameters,
               startLine: m.startLine,
               endLine: m.endLine,
            })),
            comment: c.comment || null,
         })),
      };
   },
};

// ---------------------------------------------------------------------------
// get_project_tree
// ---------------------------------------------------------------------------
export const get_project_tree = {
   name: "get_project_tree",
   title: "Leer  rbol del proyecto .pjx",
   description:
      "Lee el archivo .pjx (que internamente es un DBF) y devuelve la lista de archivos " +
      "registrados en el proyecto FoxPro con su tipo, ruta y descripci n.",
   inputSchema: {
      type: "object",
      required: ["pjxFile"],
      properties: {
         pjxFile: {
            type: "string",
            description: "Ruta relativa al proyecto del archivo .pjx.",
         },
      },
   },
   async run({ pjxFile }) {
      const absPath = resolveSafe(pjxFile);
      if (!fs.existsSync(absPath)) {
         throw new Error(`Archivo .pjx no encontrado: ${pjxFile}`);
      }
      if (!/\.pjx$/i.test(absPath)) {
         throw new Error(`Se esperaba archivo .pjx, recibido: ${pjxFile}`);
      }

      const { records, meta } = readDbfRecords(absPath, { includeDeleted: false, limit: 5000 });

      // Tipos de  tem en un .pjx (campo TYPE):
      const TYPE_MAP = {
         "B": "Etiqueta (Label)",
         "C": "Clase",
         "D": "Base de datos (DBC)",
         "F": "Form (SCX)",
         "H": "Header (.h)",
         "K": "Tecla rapida (key labels)",
         "L": "API Library",
         "M": "Men ",
         "P": "Programa (.prg)",
         "Q": "Query",
         "R": "Report (FRX)",
         "T": "Texto",
         "V": "Class Library (VCX)",
         "Z": "Tabla libre",
         "d": "Tabla (DBF)",
         "m": "Memo",
         "z": "Otro",
      };

      const items = records.map((r) => ({
         type: r.TYPE,
         typeName: TYPE_MAP[r.TYPE] || `desconocido (${r.TYPE})`,
         name: r.NAME,
         description: r.DESCRIPT || null,
         exclude: r.EXCLUDE === true,
         mainProgram: r.MAINPROG === true,
         classOf: r.CLASS || null,
         keyField: r.KEY || null,
      })).filter((i) => i.name && i.name.trim() !== "");

      return {
         pjxFile,
         itemCount: items.length,
         fields: meta.fields.map((f) => ({ name: f.name, type: f.type, length: f.length })),
         items,
      };
   },
};

// Export agrupado para registrar todas las herramientas en server.js
export const fileTools = [
   list_prg_files,
   read_prg,
   write_prg,
   search_in_code,
   get_procedures,
   get_project_tree,
];
