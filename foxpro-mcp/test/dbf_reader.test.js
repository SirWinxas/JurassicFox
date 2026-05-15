import { test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readDbfHeader, readDbfRecords, countRecords } from "../utils/dbf_reader.js";

function buildMinimalDbf(rows) {
   const fields = [
      { name: "NOMBRE", type: "C", length: 20, decimals: 0 },
      { name: "EDAD", type: "N", length: 3, decimals: 0 },
      { name: "ACTIVO", type: "L", length: 1, decimals: 0 },
   ];

   const HEADER_SIZE = 32;
   const FIELD_DESC_SIZE = 32;
   const headerLength = HEADER_SIZE + fields.length * FIELD_DESC_SIZE + 1;
   const recordLength = 1 + fields.reduce((a, f) => a + f.length, 0);

   const total = headerLength + rows.length * recordLength + 1;
   const buf = Buffer.alloc(total, 0);

   buf[0] = 0x03;
   buf[1] = 26;
   buf[2] = 5;
   buf[3] = 15;
   buf.writeUInt32LE(rows.length, 4);
   buf.writeUInt16LE(headerLength, 8);
   buf.writeUInt16LE(recordLength, 10);
   buf[29] = 0x03;

   let off = HEADER_SIZE;
   for (const f of fields) {
      buf.write(f.name, off, "ascii");
      buf[off + 11] = f.type.charCodeAt(0);
      buf[off + 16] = f.length;
      buf[off + 17] = f.decimals;
      off += FIELD_DESC_SIZE;
   }
   buf[off] = 0x0D;
   off++;

   for (const row of rows) {
      buf[off] = row._deleted ? 0x2A : 0x20;
      off++;
      const nombre = (row.NOMBRE || "").padEnd(20, " ").slice(0, 20);
      buf.write(nombre, off, "latin1");
      off += 20;
      const edad = row.EDAD === null || row.EDAD === undefined
         ? "   "
         : String(row.EDAD).padStart(3, " ").slice(0, 3);
      buf.write(edad, off, "ascii");
      off += 3;
      buf[off] = row.ACTIVO ? "T".charCodeAt(0) : "F".charCodeAt(0);
      off++;
   }

   buf[total - 1] = 0x1A;
   return buf;
}

function writeTempDbf(rows) {
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foxmcp-"));
   const file = path.join(dir, "test.dbf");
   fs.writeFileSync(file, buildMinimalDbf(rows));
   return { file, dir };
}

test("readDbfHeader: lee header y campos", () => {
   const { file, dir } = writeTempDbf([
      { NOMBRE: "Alice", EDAD: 30, ACTIVO: true },
   ]);
   try {
      const meta = readDbfHeader(file);
      expect(meta.fileType).toBe(0x03);
      expect(meta.recordCount).toBe(1);
      expect(meta.fields.length).toBe(3);
      expect(meta.fields[0].name).toBe("NOMBRE");
      expect(meta.fields[0].type).toBe("C");
      expect(meta.fields[0].length).toBe(20);
      expect(meta.fields[1].name).toBe("EDAD");
      expect(meta.fields[1].type).toBe("N");
      expect(meta.fields[2].type).toBe("L");
      expect(meta.encoding).toBe("cp1252");
   } finally {
      fs.rmSync(dir, { recursive: true });
   }
});

test("readDbfRecords: lee filas y parsea tipos", () => {
   const { file, dir } = writeTempDbf([
      { NOMBRE: "Alice", EDAD: 30, ACTIVO: true },
      { NOMBRE: "Bob", EDAD: 42, ACTIVO: false },
      { NOMBRE: "Borrado", EDAD: 99, ACTIVO: true, _deleted: true },
   ]);
   try {
      const { records } = readDbfRecords(file);
      expect(records.length).toBe(2);
      expect(records[0].NOMBRE).toBe("Alice");
      expect(records[0].EDAD).toBe(30);
      expect(records[0].ACTIVO).toBe(true);
      expect(records[1].NOMBRE).toBe("Bob");
      expect(records[1].ACTIVO).toBe(false);
   } finally {
      fs.rmSync(dir, { recursive: true });
   }
});

test("readDbfRecords: includeDeleted devuelve borrados", () => {
   const { file, dir } = writeTempDbf([
      { NOMBRE: "Activo", EDAD: 1, ACTIVO: true },
      { NOMBRE: "Borrado", EDAD: 2, ACTIVO: false, _deleted: true },
   ]);
   try {
      const { records } = readDbfRecords(file, { includeDeleted: true });
      expect(records.length).toBe(2);
      expect(records[1]._deleted).toBe(true);
   } finally {
      fs.rmSync(dir, { recursive: true });
   }
});

test("readDbfRecords: filtro where", () => {
   const { file, dir } = writeTempDbf([
      { NOMBRE: "Alice", EDAD: 30, ACTIVO: true },
      { NOMBRE: "Bob", EDAD: 42, ACTIVO: true },
      { NOMBRE: "Carol", EDAD: 25, ACTIVO: false },
   ]);
   try {
      const { records } = readDbfRecords(file, {
         where: (r) => r.EDAD > 28,
      });
      expect(records.length).toBe(2);
   } finally {
      fs.rmSync(dir, { recursive: true });
   }
});

test("readDbfRecords: filtro fields", () => {
   const { file, dir } = writeTempDbf([
      { NOMBRE: "Alice", EDAD: 30, ACTIVO: true },
   ]);
   try {
      const { records } = readDbfRecords(file, { fields: ["NOMBRE"] });
      expect(records[0].NOMBRE).toBe("Alice");
      expect(records[0].EDAD).toBeUndefined();
   } finally {
      fs.rmSync(dir, { recursive: true });
   }
});

test("countRecords: cuenta activos y borrados", () => {
   const { file, dir } = writeTempDbf([
      { NOMBRE: "A", EDAD: 1, ACTIVO: true },
      { NOMBRE: "B", EDAD: 2, ACTIVO: true, _deleted: true },
      { NOMBRE: "C", EDAD: 3, ACTIVO: true },
      { NOMBRE: "D", EDAD: 4, ACTIVO: true, _deleted: true },
   ]);
   try {
      const c = countRecords(file);
      expect(c.total).toBe(4);
      expect(c.active).toBe(2);
      expect(c.deleted).toBe(2);
   } finally {
      fs.rmSync(dir, { recursive: true });
   }
});
