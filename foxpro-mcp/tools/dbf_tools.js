/**
 * Herramientas MCP para inspeccionar y consultar tablas DBF de Visual FoxPro:
 *  - list_dbf_tables
 *  - get_table_structure
 *  - query_dbf
 *  - get_record_count
 *  - get_dbc_info
 *  - read_memo_fields
 */

import fs from "node:fs";
import path from "node:path";
import { config, requireProjectPath, resolveSafe } from "../config.js";
import {
   readDbfHeader,
   readDbfRecords,
   countRecords,
   findDbfFiles,
} from "../utils/dbf_reader.js";

function relPath(absolute) {
   const projectPath = requireProjectPath();
   return path.relative(projectPath, absolute).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// list_dbf_tables
// ---------------------------------------------------------------------------
export const list_dbf_tables = {
   name: "list_dbf_tables",
   title: "Listar tablas DBF",
   description:
      "Lista todas las tablas .dbf bajo un directorio (recursivo). Para cada tabla devuelve " +
      "informaci n b sica: ruta, tama o, n mero de campos, tipo (DBF/VFP), si tiene memo asociado.",
   inputSchema: {
      type: "object",
      properties: {
         subdirectory: {
            type: "string",
            description: "Subdirectorio del proyecto donde buscar. Por defecto, todo el proyecto.",
         },
         includeStructure: {
            type: "boolean",
            description:
               "Si es true, incluye los nombres de campos. Por defecto false (solo metadata).",
         },
      },
   },
   async run({ subdirectory, includeStructure }) {
      const projectPath = requireProjectPath();
      const baseDir = subdirectory ? resolveSafe(subdirectory) : projectPath;
      const files = findDbfFiles(baseDir);

      const tables = files.map((full) => {
         const stat = fs.statSync(full);
         let header;
         try {
            header = readDbfHeader(full);
         } catch (err) {
            return {
               path: relPath(full),
               size: stat.size,
               error: err.message,
            };
         }
         const item = {
            path: relPath(full),
            name: path.basename(full, path.extname(full)),
            size: stat.size,
            modified: stat.mtime.toISOString(),
            fileType: header.fileTypeName,
            recordCount: header.recordCount,
            recordLength: header.recordLength,
            fieldCount: header.fields.length,
            hasMemo: header.hasMemo,
            encoding: header.encoding,
            codepageByte: `0x${header.codepageByte.toString(16).padStart(2, "0")}`,
         };
         if (includeStructure) {
            item.fields = header.fields.map((f) => ({
               name: f.name,
               type: f.type,
               length: f.length,
               decimals: f.decimals,
            }));
         }
         return item;
      });

      tables.sort((a, b) => a.path.localeCompare(b.path));
      return {
         baseDir: relPath(baseDir) || ".",
         count: tables.length,
         tables,
      };
   },
};

// ---------------------------------------------------------------------------
// get_table_structure
// ---------------------------------------------------------------------------
export const get_table_structure = {
   name: "get_table_structure",
   title: "Estructura de tabla DBF",
   description:
      "Devuelve la estructura completa de una tabla DBF: campos, tipos, longitudes, " +
      "decimales, flags, y metadata (codepage, fecha actualizaci n, etc).",
   inputSchema: {
      type: "object",
      required: ["table"],
      properties: {
         table: {
            type: "string",
            description: "Ruta relativa al .dbf.",
         },
      },
   },
   async run({ table }) {
      const absPath = resolveSafe(table);
      if (!fs.existsSync(absPath)) throw new Error(`Tabla no encontrada: ${table}`);

      const meta = readDbfHeader(absPath);
      const memoPath = absPath.replace(/\.dbf$/i, ".fpt");
      const hasMemoFile = fs.existsSync(memoPath);

      return {
         table,
         fileType: meta.fileTypeName,
         fileTypeByte: `0x${meta.fileType.toString(16).padStart(2, "0")}`,
         lastUpdate: `${meta.lastUpdate.year}-${String(meta.lastUpdate.month).padStart(2, "0")}-${String(meta.lastUpdate.day).padStart(2, "0")}`,
         recordCount: meta.recordCount,
         headerLength: meta.headerLength,
         recordLength: meta.recordLength,
         encoding: meta.encoding,
         codepageByte: `0x${meta.codepageByte.toString(16).padStart(2, "0")}`,
         hasMemo: meta.hasMemo,
         memoFile: hasMemoFile ? relPath(memoPath) : null,
         fieldCount: meta.fields.length,
         fields: meta.fields.map((f) => ({
            name: f.name,
            type: f.type,
            length: f.length,
            decimals: f.decimals,
            nullable: f.nullable,
            binary: f.binary,
            autoIncrement: f.autoIncrement,
            system: f.system,
         })),
      };
   },
};

// ---------------------------------------------------------------------------
// query_dbf
// ---------------------------------------------------------------------------
export const query_dbf = {
   name: "query_dbf",
   title: "Consultar tabla DBF",
   description:
      "Lee filas de una tabla DBF con filtros simples sobre campos. " +
      "No es SQL real: se eval an comparaciones igualdad/contains/rango sobre campos. " +
      "Devuelve filas como objetos JSON; los registros borrados se excluyen por defecto.",
   inputSchema: {
      type: "object",
      required: ["table"],
      properties: {
         table: { type: "string", description: "Ruta relativa al .dbf." },
         fields: {
            type: "array",
            items: { type: "string" },
            description: "Campos a devolver. Si se omite, devuelve todos.",
         },
         where: {
            type: "array",
            description:
               "Lista de filtros AND. Cada filtro: {field, op, value}. " +
               "op puede ser: eq, neq, gt, gte, lt, lte, contains, startsWith, endsWith, isNull, notNull.",
            items: {
               type: "object",
               required: ["field", "op"],
               properties: {
                  field: { type: "string" },
                  op: {
                     type: "string",
                     enum: [
                        "eq", "neq", "gt", "gte", "lt", "lte",
                        "contains", "startsWith", "endsWith",
                        "isNull", "notNull",
                     ],
                  },
                  value: {},
               },
            },
         },
         limit: { type: "number", description: "M ximo de filas (default 100, m x VFP_MAX_QUERY_ROWS)." },
         offset: { type: "number", description: "Filas a saltar al inicio." },
         includeDeleted: {
            type: "boolean",
            description: "Incluir registros marcados como borrados. Default false.",
         },
      },
   },
   async run({ table, fields, where, limit, offset, includeDeleted }) {
      const absPath = resolveSafe(table);
      if (!fs.existsSync(absPath)) throw new Error(`Tabla no encontrada: ${table}`);

      const effectiveLimit = Math.min(limit ?? 100, config.maxQueryRows);

      const predicate = buildWherePredicate(where);

      const result = readDbfRecords(absPath, {
         includeDeleted: !!includeDeleted,
         fields,
         where: predicate,
         limit: effectiveLimit,
         offset: offset ?? 0,
      });

      return {
         table,
         encoding: result.meta.encoding,
         totalRecordsInTable: result.meta.recordCount,
         scanned: result.stats.scanned,
         returned: result.records.length,
         truncated: result.records.length >= effectiveLimit,
         records: result.records,
      };
   },
};

function buildWherePredicate(filters) {
   if (!Array.isArray(filters) || filters.length === 0) return null;
   const normalized = filters.map((f) => ({
      field: f.field,
      fieldUpper: f.field.toUpperCase(),
      op: f.op,
      value: f.value,
   }));

   return (row) => {
      // row tiene claves con el case original; comparamos por upper
      const rowUpper = {};
      for (const k of Object.keys(row)) rowUpper[k.toUpperCase()] = row[k];

      for (const f of normalized) {
         const v = rowUpper[f.fieldUpper];
         if (!evalFilter(v, f.op, f.value)) return false;
      }
      return true;
   };
}

function evalFilter(value, op, target) {
   switch (op) {
      case "eq": return value == target;
      case "neq": return value != target;
      case "gt": return value != null && value > target;
      case "gte": return value != null && value >= target;
      case "lt": return value != null && value < target;
      case "lte": return value != null && value <= target;
      case "contains":
         return typeof value === "string" && value.toLowerCase().includes(String(target).toLowerCase());
      case "startsWith":
         return typeof value === "string" && value.toLowerCase().startsWith(String(target).toLowerCase());
      case "endsWith":
         return typeof value === "string" && value.toLowerCase().endsWith(String(target).toLowerCase());
      case "isNull": return value === null || value === undefined || value === "";
      case "notNull": return value !== null && value !== undefined && value !== "";
      default: return false;
   }
}

// ---------------------------------------------------------------------------
// get_record_count
// ---------------------------------------------------------------------------
export const get_record_count = {
   name: "get_record_count",
   title: "Contar registros DBF",
   description:
      "Cuenta los registros de una tabla DBF (total, activos y borrados marcados con *).",
   inputSchema: {
      type: "object",
      required: ["table"],
      properties: {
         table: { type: "string", description: "Ruta relativa al .dbf." },
      },
   },
   async run({ table }) {
      const absPath = resolveSafe(table);
      if (!fs.existsSync(absPath)) throw new Error(`Tabla no encontrada: ${table}`);
      const counts = countRecords(absPath);
      return { table, ...counts };
   },
};

// ---------------------------------------------------------------------------
// get_dbc_info
// ---------------------------------------------------------------------------
export const get_dbc_info = {
   name: "get_dbc_info",
   title: "Informaci n del contenedor de BD (.dbc)",
   description:
      "Lee un archivo .dbc (Database Container de VFP, que internamente es un DBF) " +
      "y devuelve sus tablas, vistas, conexiones, relaciones y procedimientos almacenados.",
   inputSchema: {
      type: "object",
      required: ["dbcFile"],
      properties: {
         dbcFile: { type: "string", description: "Ruta relativa al .dbc." },
      },
   },
   async run({ dbcFile }) {
      const absPath = resolveSafe(dbcFile);
      if (!fs.existsSync(absPath)) throw new Error(`DBC no encontrado: ${dbcFile}`);
      if (!/\.dbc$/i.test(absPath)) {
         throw new Error(`Se esperaba archivo .dbc, recibido: ${dbcFile}`);
      }

      const { records } = readDbfRecords(absPath, { includeDeleted: false, limit: 10000 });

      // El .dbc tiene una estructura jer rquica con campo PARENTID y OBJECTTYPE.
      // Tipos t picos: Database, Table, Field, Index, View, Connection, Relation,
      // StoredProc, Param.
      const byId = new Map();
      for (const r of records) {
         if (r.OBJECTID !== undefined) byId.set(r.OBJECTID, r);
      }

      function childrenOf(parentId, type) {
         return records.filter(
            (r) => r.PARENTID === parentId && (!type || r.OBJECTTYPE === type)
         );
      }

      const root = records.find((r) => r.OBJECTTYPE === "Database") || null;
      const tables = childrenOf(root ? root.OBJECTID : 0, "Table").map((t) => ({
         id: t.OBJECTID,
         name: t.OBJECTNAME,
         path: t.PROPERTY || null,
         fieldCount: childrenOf(t.OBJECTID, "Field").length,
         indexCount: childrenOf(t.OBJECTID, "Index").length,
         comment: t.CODE || null,
      }));

      const views = childrenOf(root ? root.OBJECTID : 0, "View").map((v) => ({
         id: v.OBJECTID,
         name: v.OBJECTNAME,
         comment: v.CODE || null,
      }));

      const connections = childrenOf(root ? root.OBJECTID : 0, "Connection").map((c) => ({
         id: c.OBJECTID,
         name: c.OBJECTNAME,
         comment: c.CODE || null,
      }));

      const relations = records
         .filter((r) => r.OBJECTTYPE === "Relation")
         .map((r) => ({
            id: r.OBJECTID,
            name: r.OBJECTNAME,
            parent: byId.get(r.PARENTID)?.OBJECTNAME || null,
            related: r.RIINFO || null,
         }));

      const storedProcs = records.filter((r) => r.OBJECTTYPE === "StoredProc").map((p) => ({
         id: p.OBJECTID,
         name: p.OBJECTNAME,
         code: p.CODE || null,
      }));

      return {
         dbcFile,
         database: root ? { name: root.OBJECTNAME, id: root.OBJECTID } : null,
         tables,
         views,
         connections,
         relations,
         storedProcs: storedProcs.map((p) => ({ id: p.id, name: p.name })),
         storedProcCount: storedProcs.length,
         rawRecordCount: records.length,
      };
   },
};

// ---------------------------------------------------------------------------
// read_memo_fields
// ---------------------------------------------------------------------------
export const read_memo_fields = {
   name: "read_memo_fields",
   title: "Leer campos memo de un registro",
   description:
      "Lee el contenido completo de los campos memo (tipo M) de un registro espec fico. " +
      " til cuando un campo memo es muy grande y se filtr  en query_dbf.",
   inputSchema: {
      type: "object",
      required: ["table", "recordNumber"],
      properties: {
         table: { type: "string", description: "Ruta relativa al .dbf." },
         recordNumber: {
            type: "number",
            description: "N mero de registro (1-based, como RECNO() en FoxPro).",
         },
         fields: {
            type: "array",
            items: { type: "string" },
            description: "Campos memo concretos a leer. Si se omite, devuelve todos los memo.",
         },
      },
   },
   async run({ table, recordNumber, fields }) {
      const absPath = resolveSafe(table);
      if (!fs.existsSync(absPath)) throw new Error(`Tabla no encontrada: ${table}`);

      const meta = readDbfHeader(absPath);
      const memoFields = meta.fields.filter((f) =>
         ["M", "G", "P"].includes(f.type) && (!fields || fields.map((s) => s.toUpperCase()).includes(f.name.toUpperCase()))
      );

      if (memoFields.length === 0) {
         return { table, recordNumber, memoFields: [], note: "Sin campos memo o ninguno coincide con el filtro." };
      }

      const offset = recordNumber - 1;
      const result = readDbfRecords(absPath, {
         includeDeleted: true,
         offset,
         limit: 1,
         fields: memoFields.map((f) => f.name),
      });

      if (result.records.length === 0) {
         throw new Error(`Registro ${recordNumber} no existe (tabla tiene ${meta.recordCount}).`);
      }

      const row = result.records[0];
      const out = {};
      for (const f of memoFields) {
         const v = row[f.name];
         out[f.name] = Buffer.isBuffer(v) ? { binary: true, bytes: v.length } : v;
      }
      return {
         table,
         recordNumber,
         deleted: row._deleted,
         memoFields: out,
      };
   },
};

export const dbfTools = [
   list_dbf_tables,
   get_table_structure,
   query_dbf,
   get_record_count,
   get_dbc_info,
   read_memo_fields,
];
