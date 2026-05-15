/**
 * Helpers de encoding para archivos VFP.
 * Los .prg suelen estar en CP1252 (Windows Latin1), aunque algunos en OEM (CP850).
 * Las tablas DBF guardan un byte de "codepage" en su cabecera.
 */

import iconv from "iconv-lite";

/**
 * Mapea el byte de codepage del header DBF a un encoding de iconv.
 * Referencia: https://msdn.microsoft.com/en-us/library/8599s21w.aspx
 */
const DBF_CODEPAGE_MAP = {
   0x00: "cp1252",  // No especificado, asumimos Windows
   0x01: "cp437",
   0x02: "cp850",
   0x03: "cp1252",
   0x04: "macroman",
   0x57: "cp1252",  // ANSI Current
   0x58: "cp1252",  // Western European Windows
   0x59: "cp1252",
   0x64: "cp852",
   0x65: "cp866",
   0x66: "cp865",
   0x67: "cp861",
   0x68: "cp895",   // Mazovia
   0x69: "cp620",
   0x6A: "cp737",
   0x6B: "cp857",
   0x78: "cp950",   // Chinese Big5
   0x79: "cp949",   // Korean
   0x7A: "cp936",   // Chinese Simplified
   0x7B: "cp932",   // Japanese
   0x7C: "cp874",   // Thai Windows
   0x7D: "cp1255",  // Hebrew
   0x7E: "cp1256",  // Arabic
   0x86: "cp737",
   0x87: "cp852",
   0x88: "cp857",
   0xC8: "cp1250",  // Eastern European Windows
   0xC9: "cp1251",  // Russian Windows
   0xCA: "cp1254",  // Turkish Windows
   0xCB: "cp1253",  // Greek Windows
};

export function codepageToEncoding(byte) {
   return DBF_CODEPAGE_MAP[byte] || "cp1252";
}

export function decode(buffer, encoding = "cp1252") {
   if (!buffer) return "";
   try {
      return iconv.decode(buffer, encoding);
   } catch {
      return iconv.decode(buffer, "cp1252");
   }
}

export function encode(str, encoding = "cp1252") {
   if (str === null || str === undefined) return Buffer.alloc(0);
   try {
      return iconv.encode(String(str), encoding);
   } catch {
      return iconv.encode(String(str), "cp1252");
   }
}

/**
 * Heur stica de detecci n: si el archivo contiene bytes >= 0x80 que tienen sentido
 * en CP850 (caracteres de box-drawing t picos de OEM), se asume CP850. Por defecto CP1252.
 */
export function detectEncoding(buffer) {
   if (!buffer || buffer.length === 0) return "cp1252";

   let oemMarkers = 0;
   let highBytes = 0;
   const sample = buffer.subarray(0, Math.min(buffer.length, 4096));

   for (const byte of sample) {
      if (byte >= 0x80) {
         highBytes++;
         // Caracteres t picos OEM box-drawing: 0xB0-0xDF
         if (byte >= 0xB0 && byte <= 0xDF) {
            oemMarkers++;
         }
      }
   }

   if (highBytes === 0) return "cp1252";
   if (oemMarkers / highBytes > 0.4) return "cp850";
   return "cp1252";
}
