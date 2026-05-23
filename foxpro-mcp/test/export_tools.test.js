import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { export_schema, export_table } from "../tools/export_tools.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");

let tmpDir;
let saved;

beforeAll(() => {
   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jfox-export-"));
   saved = { projectPath: config.projectPath, allowWrite: config.allowWrite };
   config.projectPath = tmpDir;
   config.allowWrite = true;
});

afterAll(() => {
   config.projectPath = saved.projectPath;
   config.allowWrite = saved.allowWrite;
   fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers: crea un .dbf mínimo válido para los tests
// ---------------------------------------------------------------------------

function writeMinimalDbf(relPath, fields, records = []) {
   const abs = path.join(tmpDir, relPath);
   fs.mkdirSync(path.dirname(abs), { recursive: true });

   // Cabecera DBF mínima (Visual FoxPro, sin memo)
   const numFields = fields.length;
   const headerSize = 32 + numFields * 32 + 1;
   const recordSize = 1 + fields.reduce((s, f) => s + f.length, 0);
   const buf = Buffer.alloc(headerSize + recordSize * records.length, 0x20);

   buf[0] = 0x03; // tipo dBASE III
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
   buf[offset] = 0x0D; // terminador de cabecera

   // Registros
   let recOffset = headerSize;
   for (const row of records) {
      buf[recOffset] = 0x20; // no borrado
      let fOffset = recOffset + 1;
      for (const f of fields) {
         const val = String(row[f.name] ?? "").padEnd(f.length, " ").slice(0, f.length);
         buf.write(val, fOffset, "latin1");
         fOffset += f.length;
      }
      recOffset += recordSize;
   }

   fs.writeFileSync(abs, buf);
   return abs;
}

// ---------------------------------------------------------------------------
// export_schema
// ---------------------------------------------------------------------------

test("export_schema: genera markdown con lista de campos", async () => {
   writeMinimalDbf("clientes.dbf", [
      { name: "CODCLI", type: "C", length: 6 },
      { name: "NOMBRE", type: "C", length: 50 },
      { name: "SALDO", type: "N", length: 12, decimals: 2 },
   ]);

   const result = await export_schema.run({ format: "markdown" });

   expect(typeof result).toBe("string");
   expect(result).toContain("CLIENTES");
   expect(result).toContain("CODCLI");
   expect(result).toContain("VARCHAR");
   expect(result).toContain("NUMERIC");
});

test("export_schema: genera mermaid erDiagram", async () => {
   const result = await export_schema.run({ format: "mermaid" });

   expect(typeof result).toBe("string");
   expect(result).toContain("erDiagram");
   expect(result).toContain("CLIENTES");
});

test("export_schema: genera JSON con estructura correcta", async () => {
   const result = await export_schema.run({ format: "json" });

   expect(typeof result).toBe("object");
   expect(Array.isArray(result.tables)).toBe(true);
   expect(result.tables.length).toBeGreaterThan(0);
   const t = result.tables.find((t) => t.name === "CLIENTES");
   expect(t).toBeDefined();
   expect(t.fields.length).toBe(3);
   expect(t.fields[0].postgresql).toContain("VARCHAR");
});

test("export_schema: format 'all' devuelve markdown + mermaid + json", async () => {
   const result = await export_schema.run({ format: "all" });

   expect(typeof result.markdown).toBe("string");
   expect(typeof result.mermaid).toBe("string");
   expect(typeof result.json).toBe("object");
});

test("export_schema: escribe a outputFile", async () => {
   await export_schema.run({ format: "markdown", outputFile: "docs/schema.md" });

   const absOut = path.join(tmpDir, "docs/schema.md");
   expect(fs.existsSync(absOut)).toBe(true);
   const content = fs.readFileSync(absOut, "utf8");
   expect(content).toContain("CLIENTES");
});

test("export_schema: format 'all' con outputFile genera tres archivos", async () => {
   await export_schema.run({ format: "all", outputFile: "docs/schema" });

   expect(fs.existsSync(path.join(tmpDir, "docs/schema.md"))).toBe(true);
   expect(fs.existsSync(path.join(tmpDir, "docs/schema.mermaid"))).toBe(true);
   expect(fs.existsSync(path.join(tmpDir, "docs/schema.json"))).toBe(true);
});

// ---------------------------------------------------------------------------
// export_table
// ---------------------------------------------------------------------------

test("export_table: formato json devuelve registros", async () => {
   writeMinimalDbf("productos.dbf",
      [
         { name: "COD", type: "C", length: 4 },
         { name: "DESC", type: "C", length: 20 },
         { name: "PRECIO", type: "N", length: 10, decimals: 2 },
      ],
      [
         { COD: "P001", DESC: "Tornillo", PRECIO: "1.50" },
         { COD: "P002", DESC: "Tuerca",   PRECIO: "0.80" },
      ]
   );

   const result = await export_table.run({ table: "productos.dbf", format: "json" });

   expect(result.rows).toBe(2);
   expect(Array.isArray(result.data)).toBe(true);
});

test("export_table: formato csv incluye cabecera", async () => {
   const result = await export_table.run({ table: "productos.dbf", format: "csv" });

   expect(typeof result.data).toBe("string");
   expect(result.data).toContain("COD");
   expect(result.data).toContain("PRECIO");
});

test("export_table: formato sql postgresql genera CREATE TABLE", async () => {
   const result = await export_table.run({
      table: "productos.dbf",
      format: "sql",
      dialect: "postgresql",
   });

   expect(typeof result.data).toBe("string");
   expect(result.data).toContain("CREATE TABLE IF NOT EXISTS productos");
   expect(result.data).toContain("VARCHAR");
   expect(result.data).toContain("NUMERIC");
});

test("export_table: formato sql sqlite usa tipos correctos", async () => {
   const result = await export_table.run({
      table: "productos.dbf",
      format: "sql",
      dialect: "sqlite",
   });

   expect(result.data).toContain("CREATE TABLE IF NOT EXISTS productos");
   expect(result.data).toContain("TEXT");
   expect(result.data).toContain("REAL");
   expect(result.data).not.toContain("VARCHAR");
});

test("export_table: escribe a outputFile y devuelve stats", async () => {
   const result = await export_table.run({
      table: "productos.dbf",
      format: "sql",
      dialect: "postgresql",
      outputFile: "exports/productos.sql",
   });

   expect(result.outputFile).toBe("exports/productos.sql");
   expect(result.rows).toBe(2);
   expect(result.bytes).toBeGreaterThan(0);
   expect(fs.existsSync(path.join(tmpDir, "exports/productos.sql"))).toBe(true);
});
