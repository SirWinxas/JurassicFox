#!/usr/bin/env node
/**
 * Adaptador HTTP para JurassicFox foxpro-mcp.
 * Expone POST /query y GET /health para que el script de migración
 * pueda leer tablas DBF sin necesidad de protocolo MCP.
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

// Propagar variables al entorno antes de que config.js las lea
if (!process.env.VFP_MAX_QUERY_ROWS) {
  process.env.VFP_MAX_QUERY_ROWS = "50000";
}

// ── Importar herramientas después de fijar env ────────────────────────────────
const { config } = await import("./config.js");
const { query_dbf } = await import("./tools/dbf_tools.js");

const PAGE_SIZE = 10000;

// ── Resolver tabla: acepta nombre sin extensión, busca case-insensitivo ───────
function resolveTable(name) {
  const projectPath = config.projectPath;
  if (!projectPath) throw new Error("VFP_PROJECT_PATH no definido. Ejecútalo con: VFP_PROJECT_PATH=... node http_adapter.js");

  // Candidatos a probar en orden
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

  // Búsqueda case-insensitive en el directorio
  const nameLower = (name.toLowerCase().endsWith(".dbf") ? name : `${name}.dbf`).toLowerCase();
  const entries = fs.readdirSync(projectPath, { withFileTypes: true });
  const match = entries.find(e => e.isFile() && e.name.toLowerCase() === nameLower);
  if (match) return match.name;

  throw new Error(`Tabla no encontrada: "${name}" en ${projectPath}`);
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

// ── Servidor HTTP ─────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (e) { reject(new Error("JSON inválido en el body")); }
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

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";

  // GET /health
  if (req.method === "GET" && url === "/health") {
    send(res, 200, {
      ok: true,
      projectPath: config.projectPath ?? null,
      maxQueryRows: Number(process.env.VFP_MAX_QUERY_ROWS),
    });
    return;
  }

  // POST /query  { table: string, where?: [{field, op, value?}] }
  if (req.method === "POST" && url === "/query") {
    try {
      const { table, where } = await readBody(req);
      if (!table) { send(res, 400, { error: "Campo 'table' requerido" }); return; }
      const data = await queryAll(table, where);
      send(res, 200, data);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n[jurassicfox-http] Escuchando en http://localhost:${PORT}`);
  console.log(`[jurassicfox-http] Proyecto VFP: ${config.projectPath ?? "⚠  VFP_PROJECT_PATH no definido"}`);
  console.log(`[jurassicfox-http] Límite filas: ${process.env.VFP_MAX_QUERY_ROWS}`);
  console.log(`[jurassicfox-http] Endpoints: GET /health  POST /query\n`);
});

server.on("error", (e) => {
  console.error(`[jurassicfox-http] Error: ${e.message}`);
  process.exit(1);
});
