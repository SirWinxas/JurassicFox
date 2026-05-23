import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 13199;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADAPTER = path.resolve(import.meta.dir, "../http_adapter.js");

let tmpDir;
let serverProc;

// ---------------------------------------------------------------------------
// Helper: DBF mínimo válido (mismo que export_tools.test.js)
// ---------------------------------------------------------------------------
function writeMinimalDbf(absPath, fields, records = []) {
   fs.mkdirSync(path.dirname(absPath), { recursive: true });

   const numFields = fields.length;
   const headerSize = 32 + numFields * 32 + 1;
   const recordSize = 1 + fields.reduce((s, f) => s + f.length, 0);
   const buf = Buffer.alloc(headerSize + recordSize * records.length, 0x20);

   buf[0] = 0x03;
   buf[8] = headerSize & 0xFF;
   buf[9] = (headerSize >> 8) & 0xFF;
   buf[10] = recordSize & 0xFF;
   buf[11] = (recordSize >> 8) & 0xFF;
   buf[4] = records.length & 0xFF;
   buf[5] = (records.length >> 8) & 0xFF;

   let offset = 32;
   for (const f of fields) {
      buf.write(f.name.padEnd(11, "\0"), offset, "ascii");
      buf[offset + 11] = f.type.charCodeAt(0);
      buf[offset + 16] = f.length;
      buf[offset + 17] = f.decimals || 0;
      offset += 32;
   }
   buf[offset] = 0x0D;

   let recOffset = headerSize;
   for (const row of records) {
      buf[recOffset] = 0x20;
      let fOffset = recOffset + 1;
      for (const f of fields) {
         const val = String(row[f.name] ?? "").padEnd(f.length, " ").slice(0, f.length);
         buf.write(val, fOffset, "latin1");
         fOffset += f.length;
      }
      recOffset += recordSize;
   }

   fs.writeFileSync(absPath, buf);
}

// ---------------------------------------------------------------------------
// Setup: arrancar el servidor como proceso hijo
// ---------------------------------------------------------------------------
beforeAll(async () => {
   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jfox-httpsrv-"));

   writeMinimalDbf(path.join(tmpDir, "clientes.dbf"),
      [
         { name: "CODCLI", type: "C", length: 6 },
         { name: "NOMBRE", type: "C", length: 40 },
      ],
      [
         { CODCLI: "C001", NOMBRE: "Ana García" },
         { CODCLI: "C002", NOMBRE: "Luis Pérez" },
      ]
   );

   serverProc = spawn("bun", [ADAPTER, "--port", String(PORT)], {
      env: { ...process.env, VFP_PROJECT_PATH: tmpDir, VFP_MAX_QUERY_ROWS: "1000" },
      stdio: ["ignore", "pipe", "pipe"],
   });

   await new Promise((resolve, reject) => {
      const timeout = setTimeout(
         () => reject(new Error("Timeout esperando arranque del servidor HTTP")),
         15_000
      );
      serverProc.stdout.on("data", (chunk) => {
         if (chunk.toString().includes("Escuchando")) {
            clearTimeout(timeout);
            resolve();
         }
      });
      serverProc.on("error", (err) => { clearTimeout(timeout); reject(err); });
      serverProc.on("exit", (code) => {
         if (code !== null && code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`Servidor salió con código ${code}`));
         }
      });
   });
}, 20_000);

afterAll(() => {
   serverProc?.kill();
   try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignorar */ }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("GET /health devuelve ok:true con versión y endpoints", async () => {
   const res = await fetch(`${BASE_URL}/health`);
   expect(res.status).toBe(200);
   const json = await res.json();
   expect(json.ok).toBe(true);
   expect(typeof json.version).toBe("string");
   expect(Array.isArray(json.endpoints)).toBe(true);
   expect(json.endpoints).toContain("GET /tables");
});

test("GET /tables lista las tablas DBF del proyecto", async () => {
   const res = await fetch(`${BASE_URL}/tables`);
   expect(res.status).toBe(200);
   const json = await res.json();
   expect(typeof json.count).toBe("number");
   expect(json.count).toBeGreaterThan(0);
   expect(Array.isArray(json.tables)).toBe(true);
   const names = json.tables.map((t) => t.name);
   expect(names).toContain("CLIENTES");
});

test("GET /structure?table=clientes devuelve campos y metadatos", async () => {
   const res = await fetch(`${BASE_URL}/structure?table=clientes`);
   expect(res.status).toBe(200);
   const json = await res.json();
   expect(json.table).toBe("CLIENTES");
   expect(Array.isArray(json.fields)).toBe(true);
   expect(json.fields.find((f) => f.name === "CODCLI")).toBeDefined();
   expect(json.fields.find((f) => f.name === "NOMBRE")).toBeDefined();
   expect(typeof json.recordCount).toBe("number");
});

test("GET /structure sin parámetro devuelve 400", async () => {
   const res = await fetch(`${BASE_URL}/structure`);
   expect(res.status).toBe(400);
   const json = await res.json();
   expect(typeof json.error).toBe("string");
});

test("GET /structure?table=noexiste devuelve 404", async () => {
   const res = await fetch(`${BASE_URL}/structure?table=noexiste`);
   expect(res.status).toBe(404);
   const json = await res.json();
   expect(typeof json.error).toBe("string");
});

test("POST /query devuelve todos los registros de clientes", async () => {
   const res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: "clientes" }),
   });
   expect(res.status).toBe(200);
   const json = await res.json();
   expect(json.count).toBe(2);
   expect(Array.isArray(json.rows)).toBe(true);
});

test("POST /query acepta nombre de tabla sin extensión", async () => {
   const res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: "CLIENTES" }),
   });
   expect(res.status).toBe(200);
});

test("POST /query sin campo table devuelve 400", async () => {
   const res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
   });
   expect(res.status).toBe(400);
});

test("POST /query tabla inexistente devuelve 404", async () => {
   const res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: "noexiste" }),
   });
   expect(res.status).toBe(404);
});

test("POST /query con JSON malformado devuelve 400", async () => {
   const res = await fetch(`${BASE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ esto no es json }",
   });
   expect(res.status).toBe(400);
});

test("GET ruta desconocida devuelve 404 con lista de endpoints", async () => {
   const res = await fetch(`${BASE_URL}/api/desconocido`);
   expect(res.status).toBe(404);
   const json = await res.json();
   expect(Array.isArray(json.endpoints)).toBe(true);
});
