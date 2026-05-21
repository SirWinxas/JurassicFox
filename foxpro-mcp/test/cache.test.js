import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOrLoad, getOrLoadSync, invalidate, clear } from "../utils/cache.js";

let tmpDir;

beforeEach(() => {
   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jfox-cache-"));
   clear();
});

function writeFile(name, content) {
   const p = path.join(tmpDir, name);
   fs.writeFileSync(p, content, "utf8");
   return p;
}

// ---------------------------------------------------------------------------
// getOrLoadSync
// ---------------------------------------------------------------------------

test("getOrLoadSync: llama al loader la primera vez", () => {
   const file = writeFile("a.txt", "hola");
   let calls = 0;
   const val = getOrLoadSync(file, () => { calls++; return "resultado"; });
   expect(val).toBe("resultado");
   expect(calls).toBe(1);
});

test("getOrLoadSync: usa caché en la segunda llamada sin cambios", () => {
   const file = writeFile("b.txt", "hola");
   let calls = 0;
   const loader = () => { calls++; return "v" + calls; };
   getOrLoadSync(file, loader);
   const val2 = getOrLoadSync(file, loader);
   expect(val2).toBe("v1");
   expect(calls).toBe(1);
});

test("getOrLoadSync: recarga cuando el archivo cambia", () => {
   const file = writeFile("c.txt", "original");
   let calls = 0;
   const loader = () => { calls++; return fs.readFileSync(file, "utf8"); };

   const v1 = getOrLoadSync(file, loader);
   expect(v1).toBe("original");

   // Espera 10 ms y sobreescribe para cambiar mtime
   Bun.sleepSync(10);
   fs.writeFileSync(file, "modificado", "utf8");

   const v2 = getOrLoadSync(file, loader);
   expect(v2).toBe("modificado");
   expect(calls).toBe(2);
});

test("getOrLoadSync: llama al loader si el archivo no existe", () => {
   const missing = path.join(tmpDir, "no_existe.txt");
   let calls = 0;
   const val = getOrLoadSync(missing, () => { calls++; return "fallback"; });
   expect(val).toBe("fallback");
   expect(calls).toBe(1);
});

// ---------------------------------------------------------------------------
// getOrLoad (async)
// ---------------------------------------------------------------------------

test("getOrLoad: funciona con loader async", async () => {
   const file = writeFile("d.txt", "async");
   let calls = 0;
   const val = await getOrLoad(file, async () => { calls++; return "async-result"; });
   expect(val).toBe("async-result");
   expect(calls).toBe(1);
});

test("getOrLoad: usa caché en segunda llamada", async () => {
   const file = writeFile("e.txt", "datos");
   let calls = 0;
   const loader = async () => { calls++; return "v" + calls; };
   await getOrLoad(file, loader);
   const v2 = await getOrLoad(file, loader);
   expect(v2).toBe("v1");
   expect(calls).toBe(1);
});

// ---------------------------------------------------------------------------
// invalidate
// ---------------------------------------------------------------------------

test("invalidate: fuerza recarga en la siguiente llamada", () => {
   const file = writeFile("f.txt", "inicial");
   let calls = 0;
   const loader = () => { calls++; return "v" + calls; };

   getOrLoadSync(file, loader);
   invalidate(file);
   getOrLoadSync(file, loader);

   expect(calls).toBe(2);
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

test("clear: invalida toda la caché", () => {
   const f1 = writeFile("g1.txt", "g1");
   const f2 = writeFile("g2.txt", "g2");
   let calls = 0;
   const loader = () => { calls++; return "x"; };

   getOrLoadSync(f1, loader);
   getOrLoadSync(f2, loader);
   clear();
   getOrLoadSync(f1, loader);
   getOrLoadSync(f2, loader);

   expect(calls).toBe(4);
});
