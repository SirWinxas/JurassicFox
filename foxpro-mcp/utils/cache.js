/**
 * Caché mtime para estructuras leídas del disco (DBF headers, árboles de proyecto, etc.).
 * Evita releer un archivo si su fecha de modificación no ha cambiado.
 *
 * Uso:
 *   const val = cache.get(absPath, () => readDbfHeader(absPath));
 */

import fs from "node:fs";

// Entrada: { value: any, mtime: number }
const store = new Map();

/**
 * Devuelve el valor cacheado si el archivo no cambió; si no, llama a `loader()`,
 * guarda el resultado y lo devuelve. loader puede ser async o sync.
 */
export async function getOrLoad(absPath, loader) {
   let mtime;
   try {
      mtime = fs.statSync(absPath).mtimeMs;
   } catch {
      return loader();
   }

   const entry = store.get(absPath);
   if (entry && entry.mtime === mtime) {
      return entry.value;
   }

   const value = await loader();
   store.set(absPath, { value, mtime });
   return value;
}

/** Versión síncrona para loaders que no son async. */
export function getOrLoadSync(absPath, loader) {
   let mtime;
   try {
      mtime = fs.statSync(absPath).mtimeMs;
   } catch {
      return loader();
   }

   const entry = store.get(absPath);
   if (entry && entry.mtime === mtime) {
      return entry.value;
   }

   const value = loader();
   store.set(absPath, { value, mtime });
   return value;
}

/** Invalida una entrada concreta (p.ej. después de escribir el archivo). */
export function invalidate(absPath) {
   store.delete(absPath);
}

/** Limpia toda la caché (útil en tests). */
export function clear() {
   store.clear();
}

export default { getOrLoad, getOrLoadSync, invalidate, clear };
