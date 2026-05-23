#!/usr/bin/env node
/**
 * Adaptador HTTP para JurassicFox foxpro-mcp.
 * Expone endpoints REST para leer tablas DBF sin protocolo MCP.
 *
 * Endpoints:
 *   GET  /health               Estado del servidor y configuración activa
 *   GET  /tables               Lista todas las tablas .dbf del proyecto
 *   GET  /structure?table=X    Campos y metadatos de una tabla
 *   POST /query                Consulta registros con filtros opcionales
 *
 * Uso:
 *   VFP_PROJECT_PATH="C:\datos\bittpv44" node http_adapter.js [--port 3100]
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";

// ── Leer argumentos ANTES de importar config (config lee env al importarse) ──
const portArg = process.argv.indexOf("--port");
const PORT = portArg !== -1 ? parseInt(process.argv[portArg + 1]) : parseInt(process.env.PORT ?? "3100");

if (!process.env.VFP_MAX_QUERY_ROWS) {
  process.env.VFP_MAX_QUERY_ROWS = "50000";
}

// ── Importar herramientas después de fijar env ────────────────────────────────
const { config } = await import("./config.js");
const { query_dbf } = await import("./tools/dbf_tools.js");
const { readDbfHeader, findDbfFiles } = await import("./utils/dbf_reader.js");

const PAGE_SIZE = 10000;
const MAX_BODY_BYTES = 100 * 1024; // 100 KB

// ── Resolver tabla: acepta nombre sin extensión, busca case-insensitivo ───────
function resolveTable(name) {
  const projectPath = config.projectPath;
  if (!projectPath) throw Object.assign(new Error("VFP_PROJECT_PATH no definido"), { code: 503 });

  const candidates = [
    name,
    `${name}.dbf`,
    `${name}.DBF`,
    `${name.toUpperCase()}.DBF`,
    `${name.toUpperCase()}.dbf`,
  ];
  for (const c of candidates) {
    const full = path.resolve(projectPath, c);
    if (fs.existsSync(full)) return path.relative(projectPath, full);
  }

  const nameLower = (name.toLowerCase().endsWith(".dbf") ? name : `${name}.dbf`).toLowerCase();
  const entries = fs.readdirSync(projectPath, { withFileTypes: true });
  const match = entries.find(e => e.isFile() && e.name.toLowerCase() === nameLower);
  if (match) return match.name;

  throw Object.assign(new Error(`Tabla no encontrada: "${name}"`), { code: 404 });
}

// ── Leer TODOS los registros paginando internamente ───────────────────────────
async function queryAll(table, where) {
  const relTable = resolveTable(table);
  let offset = 0;
  const allRecords = [];

  while (true) {
    const result = await query_dbf.run({
      table: relTable,
      where: where ?? undefined,
      limit: PAGE_SIZE,
      offset,
      includeDeleted: false,
    });
    allRecords.push(...result.records);
    if (!result.truncated) break;
    offset += result.records.length;
  }

  return { rows: allRecords, count: allRecords.length };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      reject(Object.assign(new Error(`Body demasiado grande (máx ${MAX_BODY_BYTES / 1024} KB)`), { code: 413 }));
      req.resume();
      return;
    }

    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error(`Body demasiado grande (máx ${MAX_BODY_BYTES / 1024} KB)`), { code: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { reject(Object.assign(new Error("JSON inválido en el body"), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function parseUrl(rawUrl) {
  try { return new URL(rawUrl, "http://localhost"); }
  catch { return new URL("/", "http://localhost"); }
}

function statusFromError(e) {
  if (e.code && typeof e.code === "number") return e.code;
  if (e.message?.includes("no encontrada") || e.message?.includes("not found")) return 404;
  return 500;
}

// ── Request handlers ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = parseUrl(req.url ?? "/");
  const pathname = parsed.pathname;

  // GET /health
  if (req.method === "GET" && pathname === "/health") {
    send(res, 200, {
      ok: true,
      version: "0.4.0",
      projectPath: config.projectPath ?? null,
      maxQueryRows: Number(process.env.VFP_MAX_QUERY_ROWS),
      endpoints: ["GET /health", "GET /tables", "GET /structure?table=X", "POST /query"],
    });
    return;
  }

  // GET /tables
  if (req.method === "GET" && pathname === "/tables") {
    try {
      if (!config.projectPath) {
        send(res, 503, { error: "VFP_PROJECT_PATH no definido" });
        return;
      }
      const files = findDbfFiles(config.projectPath);
      const tables = files.map(f => ({
        name: path.basename(f, path.extname(f)).toUpperCase(),
        file: path.relative(config.projectPath, f).replace(/\\/g, "/"),
      }));
      send(res, 200, { count: tables.length, tables });
    } catch (e) {
      send(res, statusFromError(e), { error: e.message });
    }
    return;
  }

  // GET /structure?table=X
  if (req.method === "GET" && pathname === "/structure") {
    const tableName = parsed.searchParams.get("table");
    if (!tableName) {
      send(res, 400, { error: "Parámetro 'table' requerido (e.g. /structure?table=clientes)" });
      return;
    }
    try {
      const relTable = resolveTable(tableName);
      const absPath = path.join(config.projectPath, relTable);
      const header = readDbfHeader(absPath);
      send(res, 200, {
        table: path.basename(relTable, path.extname(relTable)).toUpperCase(),
        file: relTable.replace(/\\/g, "/"),
        type: header.fileTypeName,
        recordCount: header.recordCount,
        fields: header.fields.map(f => ({
          name: f.name,
          type: f.type,
          length: f.length,
          decimals: f.decimals,
        })),
      });
    } catch (e) {
      send(res, statusFromError(e), { error: e.message });
    }
    return;
  }

  // POST /query  { table: string, where?: [{field, op, value?}] }
  if (req.method === "POST" && pathname === "/query") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      send(res, statusFromError(e), { error: e.message });
      return;
    }
    const { table, where } = body;
    if (!table || typeof table !== "string") {
      send(res, 400, { error: "Campo 'table' requerido (string)" });
      return;
    }
    try {
      const data = await queryAll(table, where);
      send(res, 200, data);
    } catch (e) {
      send(res, statusFromError(e), { error: e.message });
    }
    return;
  }

  send(res, 404, { error: "Endpoint no encontrado", endpoints: ["GET /health", "GET /tables", "GET /structure?table=X", "POST /query"] });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n[jurassicfox-http] Escuchando en http://localhost:${PORT}`);
  console.log(`[jurassicfox-http] Proyecto VFP : ${config.projectPath ?? "⚠  VFP_PROJECT_PATH no definido"}`);
  console.log(`[jurassicfox-http] Límite filas  : ${process.env.VFP_MAX_QUERY_ROWS}`);
  console.log(`[jurassicfox-http] Endpoints     :`);
  console.log(`[jurassicfox-http]   GET  /health`);
  console.log(`[jurassicfox-http]   GET  /tables`);
  console.log(`[jurassicfox-http]   GET  /structure?table=X`);
  console.log(`[jurassicfox-http]   POST /query\n`);
});

server.on("error", (e) => {
  console.error(`[jurassicfox-http] Error: ${e.message}`);
  process.exit(1);
});
