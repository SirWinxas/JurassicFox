/**
 * Lector puro JS de archivos DBF (incluido formato Visual FoxPro).
 *
 * Soporta:
 *  - DBF: dBASE III/IV (0x03), FoxPro 2 (0xF5, 0xFB), VFP (0x30, 0x31, 0x32)
 *  - Tipos: C, N, F, D, T, L, M, B, I, Y, G, P, V, Q, 0
 *  - Memos: archivos .fpt asociados (formato VFP big-endian con header de 512 bytes)
 *  - Codepages: a partir del byte 29 del header
 *  - Registros borrados (marca 0x2A = '*')
 *
 * No requiere VFP instalado; lee directamente los bytes.
 */

import fs from "node:fs";
import path from "node:path";
import { codepageToEncoding, decode } from "./encoding.js";

const HEADER_SIZE = 32;
const FIELD_DESC_SIZE = 32;
const FIELD_TERMINATOR = 0x0D;
const DELETED_MARKER = 0x2A;        // '*'
const ACTIVE_MARKER = 0x20;         // ' '

const FILE_TYPE_NAMES = {
   0x02: "FoxBASE",
   0x03: "dBASE III/IV",
   0x04: "dBASE IV",
   0x05: "dBASE V",
   0x30: "Visual FoxPro",
   0x31: "Visual FoxPro autoincr",
   0x32: "Visual FoxPro varchar",
   0x43: "dBASE IV con memo",
   0x7B: "dBASE IV con memo",
   0x83: "dBASE III con memo",
   0x8B: "dBASE IV con memo",
   0xCB: "dBASE IV SQL",
   0xF5: "FoxPro 2.x con memo",
   0xFB: "FoxPro 2.x",
};

function hasMemoFile(fileType) {
   // El bit alto en muchos formatos indica memo asociado
   return (
      fileType === 0x30 ||
      fileType === 0x31 ||
      fileType === 0x32 ||
      fileType === 0x83 ||
      fileType === 0x8B ||
      fileType === 0xF5 ||
      (fileType & 0x80) !== 0
   );
}

/**
 * Lee el header y los descriptores de campo de un DBF.
 * Retorna metadata sin leer registros (operaci n barata).
 */
export function readDbfHeader(dbfPath) {
   const fd = fs.openSync(dbfPath, "r");
   try {
      const header = Buffer.alloc(HEADER_SIZE);
      const headerBytes = fs.readSync(fd, header, 0, HEADER_SIZE, 0);
      if (headerBytes < HEADER_SIZE) {
         throw new Error(`Archivo DBF truncado: ${dbfPath}`);
      }

      const fileType = header[0];
      const lastUpdate = {
         year: header[1] < 80 ? 2000 + header[1] : 1900 + header[1],
         month: header[2],
         day: header[3],
      };
      const recordCount = header.readUInt32LE(4);
      const headerLength = header.readUInt16LE(8);
      const recordLength = header.readUInt16LE(10);
      const tableFlags = header[28];
      const codepageByte = header[29];
      const encoding = codepageToEncoding(codepageByte);

      // Leer descriptores de campo
      const fieldsBufferSize = headerLength - HEADER_SIZE;
      const fieldsBuf = Buffer.alloc(fieldsBufferSize);
      fs.readSync(fd, fieldsBuf, 0, fieldsBufferSize, HEADER_SIZE);

      const fields = [];
      let offset = 0;
      let recordOffset = 1; // primer byte del registro es la marca de borrado

      while (offset < fieldsBufferSize && fieldsBuf[offset] !== FIELD_TERMINATOR) {
         if (fieldsBufferSize - offset < FIELD_DESC_SIZE) break;

         const desc = fieldsBuf.subarray(offset, offset + FIELD_DESC_SIZE);
         // Nombre: bytes 0..10, null-terminated (ASCII)
         let nameEnd = 0;
         while (nameEnd < 11 && desc[nameEnd] !== 0x00) nameEnd++;
         const name = desc.subarray(0, nameEnd).toString("ascii");
         const type = String.fromCharCode(desc[11]);
         const length = desc[16];
         const decimals = desc[17];
         const flags = desc[31];

         fields.push({
            name,
            type,
            length,
            decimals,
            flags,
            offset: recordOffset,
            nullable: (flags & 0x02) !== 0,
            system: (flags & 0x01) !== 0,
            binary: (flags & 0x04) !== 0,
            autoIncrement: (flags & 0x0C) === 0x0C,
         });

         recordOffset += length;
         offset += FIELD_DESC_SIZE;
      }

      return {
         path: dbfPath,
         fileType,
         fileTypeName: FILE_TYPE_NAMES[fileType] || `0x${fileType.toString(16)}`,
         hasMemo: hasMemoFile(fileType),
         lastUpdate,
         recordCount,
         headerLength,
         recordLength,
         tableFlags,
         codepageByte,
         encoding,
         fields,
      };
   } finally {
      fs.closeSync(fd);
   }
}

/**
 * Abre el .fpt asociado a un .dbf si existe.
 * Retorna { fd, blockSize } o null.
 */
function openMemoFile(dbfPath) {
   const candidates = [
      dbfPath.replace(/\.dbf$/i, ".fpt"),
      dbfPath.replace(/\.dbf$/i, ".FPT"),
   ];
   for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
         const fd = fs.openSync(candidate, "r");
         const headerBuf = Buffer.alloc(512);
         fs.readSync(fd, headerBuf, 0, 512, 0);
         // En FPT los enteros son BIG endian
         const blockSize = headerBuf.readUInt16BE(6) || 64;
         return { fd, blockSize, path: candidate };
      }
   }
   return null;
}

/**
 * Lee el contenido de un bloque memo dado su n mero de bloque.
 */
function readMemoBlock(memoCtx, blockNumber, encoding) {
   if (!memoCtx || !blockNumber || blockNumber <= 0) return null;
   const { fd, blockSize } = memoCtx;
   const offset = blockNumber * blockSize;

   const headerBuf = Buffer.alloc(8);
   const read = fs.readSync(fd, headerBuf, 0, 8, offset);
   if (read < 8) return null;

   const type = headerBuf.readUInt32BE(0);
   const length = headerBuf.readUInt32BE(4);

   if (length === 0) return type === 1 ? "" : Buffer.alloc(0);
   if (length > 50 * 1024 * 1024) {
      // Cota de seguridad: no leer >50MB de un solo memo
      throw new Error(`Memo bloque ${blockNumber} demasiado grande: ${length} bytes`);
   }

   const dataBuf = Buffer.alloc(length);
   fs.readSync(fd, dataBuf, 0, length, offset + 8);

   // type 1 = texto, type 2 = binario/picture
   if (type === 1) {
      return decode(dataBuf, encoding);
   }
   return dataBuf;
}

/**
 * Convierte un campo individual de bytes a su valor JS apropiado.
 */
function parseField(field, recordBuf, memoCtx, encoding) {
   const slice = recordBuf.subarray(field.offset, field.offset + field.length);

   switch (field.type) {
      case "C": {
         // Character: padding con espacios al final
         const text = decode(slice, encoding);
         return text.replace(/\s+$/, "");
      }
      case "N":
      case "F": {
         const text = slice.toString("ascii").trim();
         if (text === "" || text === "*") return null;
         const n = Number(text);
         return Number.isNaN(n) ? null : n;
      }
      case "D": {
         // Fecha YYYYMMDD
         const text = slice.toString("ascii").trim();
         if (text === "" || text === "00000000") return null;
         if (text.length !== 8) return null;
         const y = Number(text.slice(0, 4));
         const m = Number(text.slice(4, 6));
         const d = Number(text.slice(6, 8));
         if (!y || !m || !d) return null;
         return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
      }
      case "T": {
         // DateTime: 4 bytes julian + 4 bytes milisegundos desde medianoche
         if (slice.length < 8) return null;
         const julian = slice.readInt32LE(0);
         const ms = slice.readInt32LE(4);
         if (julian === 0 && ms === 0) return null;
         // Conversi n d a juliano -> Date (epoch JS = 2440588 julian)
         const date = new Date((julian - 2440588) * 86400000 + ms);
         if (isNaN(date.getTime())) return null;
         return date.toISOString();
      }
      case "L": {
         const ch = String.fromCharCode(slice[0]).toUpperCase();
         if (ch === "T" || ch === "Y") return true;
         if (ch === "F" || ch === "N") return false;
         return null;
      }
      case "I": {
         if (slice.length < 4) return null;
         return slice.readInt32LE(0);
      }
      case "B": {
         // Double 8 bytes IEEE
         if (slice.length < 8) return null;
         return slice.readDoubleLE(0);
      }
      case "Y": {
         // Currency: int64 little endian, escalado por 10000
         if (slice.length < 8) return null;
         const big = slice.readBigInt64LE(0);
         return Number(big) / 10000;
      }
      case "M":
      case "G":
      case "P": {
         // Memo: 4 bytes con n mero de bloque (LE en VFP, ASCII en dBASE III)
         let blockNumber;
         if (field.length === 4) {
            blockNumber = slice.readUInt32LE(0);
         } else if (field.length === 10) {
            // dBASE III: 10 caracteres ASCII con el n mero
            const txt = slice.toString("ascii").trim();
            blockNumber = txt === "" ? 0 : Number(txt);
         } else {
            blockNumber = 0;
         }
         if (!memoCtx) return null;
         try {
            return readMemoBlock(memoCtx, blockNumber, encoding);
         } catch (err) {
            return `<memo error: ${err.message}>`;
         }
      }
      case "V":
      case "Q": {
         // Varchar/Varbinary VFP9: el  ltimo byte indica longitud real
         if (slice.length === 0) return field.type === "V" ? "" : Buffer.alloc(0);
         const lastByte = slice[slice.length - 1];
         const realLength = lastByte <= field.length ? lastByte : field.length;
         const data = slice.subarray(0, realLength);
         return field.type === "V" ? decode(data, encoding) : Buffer.from(data);
      }
      case "0": {
         // _NullFlags (no se expone)
         return null;
      }
      default: {
         return slice.toString("ascii");
      }
   }
}

/**
 * Lee todos (o un subconjunto) de los registros de un DBF.
 * options: { includeDeleted, limit, offset, fields, where }
 *   - fields: array de nombres de campo para limitar columnas
 *   - where: funci n (row) => boolean
 */
export function readDbfRecords(dbfPath, options = {}) {
   const meta = readDbfHeader(dbfPath);
   const memoCtx = meta.hasMemo ? openMemoFile(dbfPath) : null;

   const includeDeleted = options.includeDeleted === true;
   const limit = options.limit ?? Infinity;
   const offset = options.offset ?? 0;
   const fieldFilter = options.fields ? new Set(options.fields.map((f) => f.toUpperCase())) : null;
   const where = typeof options.where === "function" ? options.where : null;

   const fd = fs.openSync(dbfPath, "r");
   const records = [];
   let scanned = 0;
   let matched = 0;
   let skipped = 0;

   try {
      const recordBuf = Buffer.alloc(meta.recordLength);
      for (let i = 0; i < meta.recordCount; i++) {
         const recOffset = meta.headerLength + i * meta.recordLength;
         const read = fs.readSync(fd, recordBuf, 0, meta.recordLength, recOffset);
         if (read < meta.recordLength) break;

         scanned++;
         const deleted = recordBuf[0] === DELETED_MARKER;
         if (deleted && !includeDeleted) continue;

         const row = { _deleted: deleted, _recno: i + 1 };
         for (const field of meta.fields) {
            if (field.system && field.name === "_NullFlags") continue;
            if (fieldFilter && !fieldFilter.has(field.name.toUpperCase())) continue;
            row[field.name] = parseField(field, recordBuf, memoCtx, meta.encoding);
         }

         if (where && !where(row)) continue;

         if (skipped < offset) {
            skipped++;
            continue;
         }
         records.push(row);
         matched++;
         if (records.length >= limit) break;
      }
   } finally {
      fs.closeSync(fd);
      if (memoCtx) fs.closeSync(memoCtx.fd);
   }

   return {
      meta,
      records,
      stats: { scanned, returned: matched },
   };
}

/**
 * Cuenta registros sin cargar los datos. R pido.
 */
export function countRecords(dbfPath) {
   const meta = readDbfHeader(dbfPath);
   const fd = fs.openSync(dbfPath, "r");
   let active = 0;
   let deleted = 0;
   try {
      const recordBuf = Buffer.alloc(meta.recordLength);
      for (let i = 0; i < meta.recordCount; i++) {
         const recOffset = meta.headerLength + i * meta.recordLength;
         fs.readSync(fd, recordBuf, 0, meta.recordLength, recOffset);
         if (recordBuf[0] === DELETED_MARKER) deleted++;
         else active++;
      }
   } finally {
      fs.closeSync(fd);
   }
   return {
      total: meta.recordCount,
      active,
      deleted,
   };
}

/**
 * Lista archivos .dbf bajo un directorio, recursivamente.
 */
export function findDbfFiles(rootDir) {
   const results = [];
   const stack = [rootDir];
   while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
         entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
         continue;
      }
      for (const entry of entries) {
         const full = path.join(dir, entry.name);
         if (entry.isDirectory()) {
            // No descender en .mcp_backups ni node_modules
            if (entry.name === ".mcp_backups" || entry.name === ".mcp_logs" || entry.name === "node_modules" || entry.name === ".git") {
               continue;
            }
            stack.push(full);
         } else if (entry.isFile() && /\.dbf$/i.test(entry.name)) {
            results.push(full);
         }
      }
   }
   return results;
}
