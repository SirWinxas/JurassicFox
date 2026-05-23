/**
 * Herramientas de exportación para migraciones DBF → SQL/JSON/Mermaid:
 *  - export_schema   Esquema de todas las tablas en Markdown, Mermaid ER y JSON
 *  - export_table    Datos de una tabla en JSON, CSV o SQL (INSERT)
 */

import fs from "node:fs";
import path from "node:path";
import { config, requireProjectPath, resolveSafe } from "../config.js";
import {
   readDbfHeader,
   readDbfRecords,
   findDbfFiles,
} from "../utils/dbf_reader.js";
import { getOrLoadSync } from "../utils/cache.js";
import { logAudit } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Mapas de tipos VFP → SQL
// ---------------------------------------------------------------------------

const TO_PG = {
   C: (f) => `VARCHAR(${f.length})`,
   N: (f) => f.decimals > 0 ? `NUMERIC(${f.length}, ${f.decimals})` : (f.length <= 9 ? "INTEGER" : "BIGINT"),
   F: () => "DOUBLE PRECISION",
   B: () => "DOUBLE PRECISION",
   I: () => "INTEGER",
   Y: () => "NUMERIC(20, 4)",
   D: () => "DATE",
   T: () => "TIMESTAMP",
   L: () => "BOOLEAN",
   M: () => "TEXT",
   G: () => "BYTEA",
   P: () => "BYTEA",
   V: (f) => `VARCHAR(${f.length})`,
   W: () => "BYTEA",
   Q: () => "BYTEA",
};

const TO_SQLITE = {
   C: () => "TEXT",
   N: (f) => f.decimals > 0 ? "REAL" : "INTEGER",
   F: () => "REAL",
   B: () => "REAL",
   I: () => "INTEGER",
   Y: () => "REAL",
   D: () => "TEXT",
   T: () => "TEXT",
   L: () => "INTEGER",
   M: () => "TEXT",
   G: () => "BLOB",
   P: () => "BLOB",
   V: () => "TEXT",
   W: () => "BLOB",
   Q: () => "BLOB",
};

const TO_MERMAID = {
   C: () => "varchar",
   N: (f) => f.decimals > 0 ? "decimal" : "int",
   F: () => "float",
   B: () => "float",
   I: () => "int",
   Y: () => "decimal",
   D: () => "date",
   T: () => "datetime",
   L: () => "boolean",
   M: () => "text",
   G: () => "blob",
   P: () => "blob",
};

function toSqlType(field, dialect) {
   const map = dialect === "sqlite" ? TO_SQLITE : TO_PG;
   const fn = map[field.type];
   return fn ? fn(field) : "TEXT";
}

function toMermaidType(field) {
   const fn = TO_MERMAID[field.type];
   return fn ? fn(field) : "varchar";
}

function safeName(name) {
   return name.replace(/[^A-Za-z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// Generadores de formato
// ---------------------------------------------------------------------------

function schemaToMarkdown(tables, relations) {
   const lines = [
      "# Esquema DBF del proyecto",
      "",
      `*Exportado: ${new Date().toISOString().slice(0, 10)} | ${tables.length} tablas*`,
      "",
   ];

   if (relations.length > 0) {
      lines.push("## Relaciones", "");
      for (const r of relations) {
         lines.push(`- \`${r.parentTable}\` → \`${r.childTable}\` (${r.field || "?"})  `);
      }
      lines.push("");
   }

   for (const t of tables) {
      lines.push(`## \`${t.name}\``);
      lines.push(`*${t.path} | ${t.recordCount} registros | ${t.encoding}*`, "");
      lines.push("| Campo | Tipo VFP | Longitud | PostgreSQL | SQLite |");
      lines.push("|-------|----------|----------|------------|--------|");
      for (const f of t.fields) {
         const len = f.decimals > 0 ? `${f.length}.${f.decimals}` : String(f.length);
         lines.push(`| ${f.name} | ${f.type} | ${len} | ${toSqlType(f, "postgresql")} | ${toSqlType(f, "sqlite")} |`);
      }
      lines.push("");
   }
   return lines.join("\n");
}

function schemaToMermaid(tables, relations) {
   const lines = ["erDiagram"];

   for (const t of tables) {
      lines.push(`    ${safeName(t.name)} {`);
      for (const f of t.fields) {
         lines.push(`        ${toMermaidType(f)} ${safeName(f.name)}`);
      }
      lines.push(`    }`);
   }

   for (const r of relations) {
      if (r.parentTable && r.childTable) {
         const label = r.field ? r.field.slice(0, 20) : "";
         lines.push(`    ${safeName(r.parentTable)} ||--o{ ${safeName(r.childTable)} : "${label}"`);
      }
   }

   return lines.join("\n");
}

function schemaToJson(tables, relations) {
   return {
      exportedAt: new Date().toISOString(),
      tableCount: tables.length,
      tables: tables.map((t) => ({
         name: t.name,
         path: t.path,
         recordCount: t.recordCount,
         encoding: t.encoding,
         fields: t.fields.map((f) => ({
            name: f.name,
            vfpType: f.type,
            length: f.length,
            decimals: f.decimals,
            nullable: f.nullable,
            postgresql: toSqlType(f, "postgresql"),
            sqlite: toSqlType(f, "sqlite"),
         })),
      })),
      relations,
   };
}

// ---------------------------------------------------------------------------
// Leer relaciones desde .dbc si existe
// ---------------------------------------------------------------------------

function findDbc(projectPath) {
   const entries = fs.readdirSync(projectPath, { withFileTypes: true });
   const dbc = entries.find((e) => e.isFile() && /\.dbc$/i.test(e.name));
   return dbc ? path.join(projectPath, dbc.name) : null;
}

function readRelations(dbcPath) {
   try {
      const { records } = readDbfRecords(dbcPath, { includeDeleted: false, limit: 10000 });
      const byId = new Map();
      for (const r of records) {
         if (r.OBJECTID !== undefined) byId.set(r.OBJECTID, r);
      }
      return records
         .filter((r) => r.OBJECTTYPE === "Relation")
         .map((r) => {
            const parent = byId.get(r.PARENTID);
            return {
               parentTable: parent?.OBJECTNAME || null,
               childTable: r.OBJECTNAME || null,
               field: r.RIINFO || null,
            };
         })
         .filter((r) => r.parentTable && r.childTable);
   } catch {
      return [];
   }
}

// ---------------------------------------------------------------------------
// export_schema
// ---------------------------------------------------------------------------

export const export_schema = {
   name: "export_schema",
   title: "Exportar esquema DBF",
   description:
      "Genera el esquema completo de las tablas .dbf del proyecto en varios formatos: " +
      "Markdown (con tipos SQL), Mermaid ER (diagrama de entidad-relación) y JSON. " +
      "Si existe un .dbc, incluye las relaciones entre tablas. " +
      "Útil para documentar el modelo de datos o iniciar una migración a PostgreSQL/SQLite.",
   inputSchema: {
      type: "object",
      properties: {
         format: {
            type: "string",
            enum: ["markdown", "mermaid", "json", "all"],
            description: "Formato de salida. 'all' genera los tres. Default: 'all'.",
         },
         outputFile: {
            type: "string",
            description:
               "Ruta relativa donde escribir el resultado. " +
               "Para 'all', se usan extensiones .md, .mermaid y .json automáticamente.",
         },
         dbc: {
            type: "string",
            description:
               "Ruta relativa al .dbc para extraer relaciones. " +
               "Si se omite, se intenta detectar automáticamente.",
         },
         subdirectory: {
            type: "string",
            description: "Limitar el análisis a un subdirectorio del proyecto.",
         },
         maxFields: {
            type: "number",
            description:
               "Límite de campos por tabla en el diagrama Mermaid (evita diagramas ilegibles). Default: 15.",
         },
      },
   },
   async run({ format = "all", outputFile, dbc, subdirectory, maxFields = 15 }) {
      const projectPath = requireProjectPath();
      const baseDir = subdirectory ? resolveSafe(subdirectory) : projectPath;

      // Leer headers de todas las tablas DBF
      const dbfFiles = findDbfFiles(baseDir);
      const tables = [];
      for (const full of dbfFiles) {
         try {
            const header = getOrLoadSync(full, () => readDbfHeader(full));
            const stat = fs.statSync(full);
            tables.push({
               name: path.basename(full, path.extname(full)).toUpperCase(),
               path: path.relative(projectPath, full).replace(/\\/g, "/"),
               recordCount: header.recordCount,
               encoding: header.encoding,
               fields: header.fields,
            });
         } catch { /* ignorar tablas corruptas */ }
      }

      tables.sort((a, b) => a.name.localeCompare(b.name));

      // Leer relaciones desde .dbc
      let relations = [];
      const dbcPath = dbc ? resolveSafe(dbc) : findDbc(projectPath);
      if (dbcPath && fs.existsSync(dbcPath)) {
         relations = readRelations(dbcPath);
      }

      // Mermaid usa campos limitados para legibilidad
      const tablesForMermaid = tables.map((t) => ({
         ...t,
         fields: t.fields.slice(0, maxFields),
      }));

      const fmts = format === "all" ? ["markdown", "mermaid", "json"] : [format];
      const results = {};

      for (const fmt of fmts) {
         let content;
         if (fmt === "markdown")  content = schemaToMarkdown(tables, relations);
         else if (fmt === "mermaid") content = schemaToMermaid(tablesForMermaid, relations);
         else                        content = schemaToJson(tables, relations);

         if (outputFile) {
            if (!config.allowWrite) throw new Error("Escritura deshabilitada (VFP_ALLOW_WRITE=false).");
            const ext = { markdown: ".md", mermaid: ".mermaid", json: ".json" }[fmt];
            const outBase = outputFile.replace(/\.(md|mermaid|json)$/i, "");
            const outRel = format === "all" ? `${outBase}${ext}` : outputFile;
            const absOut = resolveSafe(outRel);
            fs.mkdirSync(path.dirname(absOut), { recursive: true });
            const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
            fs.writeFileSync(absOut, text, "utf8");
            results[fmt] = { written: outRel, bytes: Buffer.byteLength(text, "utf8") };
         } else {
            results[fmt] = typeof content === "string" ? content : content;
         }
      }

      logAudit("EXPORT_SCHEMA", { format, tables: tables.length, relations: relations.length });

      return fmts.length === 1 ? results[fmts[0]] : {
         tables: tables.length,
         relations: relations.length,
         ...results,
      };
   },
};

// ---------------------------------------------------------------------------
// Generadores de datos
// ---------------------------------------------------------------------------

function csvEscape(value) {
   if (value === null || value === undefined) return "";
   const s = value instanceof Date ? value.toISOString() : String(value);
   if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
   }
   return s;
}

function rowsToCSV(fields, records) {
   const header = fields.map((f) => csvEscape(f.name)).join(",");
   const rows = records.map((r) =>
      fields.map((f) => csvEscape(r[f.name])).join(",")
   );
   return [header, ...rows].join("\n");
}

function sqlLiteral(value, vfpType, dialect) {
   if (value === null || value === undefined || value === "") return "NULL";
   switch (vfpType) {
      case "L":
         return dialect === "sqlite" ? (value ? "1" : "0") : (value ? "TRUE" : "FALSE");
      case "N": case "I": case "B": case "F": case "Y":
         return String(value).replace(",", ".");
      case "D":
         return value instanceof Date
            ? `'${value.toISOString().slice(0, 10)}'`
            : `'${String(value).replace(/'/g, "''")}'`;
      case "T":
         return value instanceof Date
            ? `'${value.toISOString().replace("T", " ").slice(0, 19)}'`
            : `'${String(value).replace(/'/g, "''")}'`;
      default:
         return `'${String(value).replace(/'/g, "''")}'`;
   }
}

function rowsToSQL(tableName, fields, records, dialect) {
   const tbl = tableName.toLowerCase();
   const lines = [`-- Tabla: ${tableName} (${records.length} filas)`, ""];

   // CREATE TABLE
   lines.push(`CREATE TABLE IF NOT EXISTS ${tbl} (`);
   const colDefs = fields.map((f, i) => {
      const comma = i < fields.length - 1 ? "," : "";
      return `  ${f.name.toLowerCase()} ${toSqlType(f, dialect)}${comma}`;
   });
   lines.push(...colDefs, ");", "");

   // INSERTs
   if (records.length > 0) {
      const colList = fields.map((f) => f.name.toLowerCase()).join(", ");
      for (const row of records) {
         const vals = fields.map((f) => sqlLiteral(row[f.name], f.type, dialect)).join(", ");
         lines.push(`INSERT INTO ${tbl} (${colList}) VALUES (${vals});`);
      }
   }

   return lines.join("\n");
}

// ---------------------------------------------------------------------------
// export_table
// ---------------------------------------------------------------------------

export const export_table = {
   name: "export_table",
   title: "Exportar datos de tabla DBF",
   description:
      "Exporta los registros de una tabla .dbf en formato JSON, CSV o SQL (INSERT). " +
      "El SQL incluye CREATE TABLE con tipos adecuados para PostgreSQL o SQLite. " +
      "Ideal para migrar datos desde Visual FoxPro a bases de datos modernas. " +
      "Para tablas grandes, usa outputFile para escribir a disco.",
   inputSchema: {
      type: "object",
      required: ["table"],
      properties: {
         table: {
            type: "string",
            description: "Ruta relativa a la tabla .dbf a exportar.",
         },
         format: {
            type: "string",
            enum: ["json", "csv", "sql"],
            description: "Formato de exportación. Default: 'json'.",
         },
         dialect: {
            type: "string",
            enum: ["postgresql", "sqlite"],
            description: "Dialecto SQL para el formato 'sql'. Default: 'postgresql'.",
         },
         outputFile: {
            type: "string",
            description:
               "Ruta relativa donde escribir el resultado. " +
               "Recomendado para tablas grandes. Si se omite, devuelve el contenido inline (límite 1000 filas).",
         },
         limit: {
            type: "number",
            description: "Máximo de registros a exportar. Default: todos.",
         },
         where: {
            type: "array",
            description:
               "Filtros opcionales (mismo formato que query_dbf). Permite exportar subconjuntos.",
            items: {
               type: "object",
               required: ["field", "op"],
               properties: {
                  field: { type: "string" },
                  op: {
                     type: "string",
                     enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith", "isNull", "notNull"],
                  },
                  value: {},
               },
            },
         },
      },
   },
   async run({ table, format = "json", dialect = "postgresql", outputFile, limit, where }) {
      const projectPath = requireProjectPath();
      const absPath = resolveSafe(table);
      if (!fs.existsSync(absPath)) throw new Error(`Tabla no encontrada: ${table}`);

      const header = getOrLoadSync(absPath, () => readDbfHeader(absPath));
      const fields = header.fields.filter((f) => !["G", "P", "W", "Q"].includes(f.type) || outputFile);

      // Predicado de filtro
      let predicate = null;
      if (Array.isArray(where) && where.length > 0) {
         predicate = buildPredicate(where);
      }

      const effectiveLimit = limit ?? (outputFile ? Infinity : 1000);
      const result = readDbfRecords(absPath, {
         includeDeleted: false,
         fields: fields.map((f) => f.name),
         where: predicate,
         limit: effectiveLimit === Infinity ? 999999 : effectiveLimit,
         offset: 0,
      });

      const records = result.records;
      const tableName = path.basename(absPath, path.extname(absPath)).toUpperCase();

      let content;
      if (format === "csv")       content = rowsToCSV(fields, records);
      else if (format === "sql")  content = rowsToSQL(tableName, fields, records, dialect);
      else                        content = records;

      if (outputFile) {
         if (!config.allowWrite) throw new Error("Escritura deshabilitada (VFP_ALLOW_WRITE=false).");
         const absOut = resolveSafe(outputFile);
         fs.mkdirSync(path.dirname(absOut), { recursive: true });
         const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
         fs.writeFileSync(absOut, text, "utf8");
         const bytes = Buffer.byteLength(text, "utf8");
         logAudit("EXPORT_TABLE", { table, format, dialect, rows: records.length, outputFile });
         return {
            table,
            format,
            dialect: format === "sql" ? dialect : undefined,
            rows: records.length,
            totalInTable: header.recordCount,
            truncated: records.length < result.stats.scanned,
            outputFile,
            bytes,
         };
      }

      logAudit("EXPORT_TABLE", { table, format, rows: records.length });
      return {
         table,
         format,
         dialect: format === "sql" ? dialect : undefined,
         rows: records.length,
         totalInTable: header.recordCount,
         truncated: effectiveLimit !== Infinity && records.length >= effectiveLimit,
         data: content,
      };
   },
};

function buildPredicate(filters) {
   const normalized = filters.map((f) => ({
      fieldUpper: f.field.toUpperCase(),
      op: f.op,
      value: f.value,
   }));
   return (row) => {
      const rowUpper = {};
      for (const k of Object.keys(row)) rowUpper[k.toUpperCase()] = row[k];
      for (const f of normalized) {
         const v = rowUpper[f.fieldUpper];
         if (!evalOp(v, f.op, f.value)) return false;
      }
      return true;
   };
}

function evalOp(v, op, target) {
   switch (op) {
      case "eq":         return v == target;
      case "neq":        return v != target;
      case "gt":         return v != null && v > target;
      case "gte":        return v != null && v >= target;
      case "lt":         return v != null && v < target;
      case "lte":        return v != null && v <= target;
      case "contains":   return typeof v === "string" && v.toLowerCase().includes(String(target).toLowerCase());
      case "startsWith": return typeof v === "string" && v.toLowerCase().startsWith(String(target).toLowerCase());
      case "endsWith":   return typeof v === "string" && v.toLowerCase().endsWith(String(target).toLowerCase());
      case "isNull":     return v === null || v === undefined || v === "";
      case "notNull":    return v !== null && v !== undefined && v !== "";
      default:           return false;
   }
}

export const exportTools = [export_schema, export_table];
