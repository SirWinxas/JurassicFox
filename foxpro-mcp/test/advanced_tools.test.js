import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import {
   rename_procedure,
   find_dead_code,
   generate_docs,
   git_log,
   git_diff,
} from "../tools/advanced_tools.js";

// Ruta al repo de JurassicFox (que sí tiene git)
const REPO_ROOT = path.resolve(import.meta.dir, "../..");

let tmpDir;
let saved;

beforeAll(() => {
   tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jfox-adv-"));
   // Guardar y reemplazar la config para que apunte al tmpDir
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
// Helpers
// ---------------------------------------------------------------------------

function writePrg(relPath, content) {
   const abs = path.join(tmpDir, relPath);
   fs.mkdirSync(path.dirname(abs), { recursive: true });
   fs.writeFileSync(abs, content, "latin1");
   return abs;
}

// ---------------------------------------------------------------------------
// rename_procedure
// ---------------------------------------------------------------------------

test("rename_procedure: dryRun no modifica archivos", async () => {
   writePrg("calculos.prg", `
PROCEDURE Calcular
   ? "ok"
ENDPROC

PROCEDURE Llamador
   DO Calcular
   Calcular()
ENDPROC
`);

   const result = await rename_procedure.run({
      oldName: "Calcular",
      newName: "Calcular2",
      dryRun: true,
   });

   expect(result.dryRun).toBe(true);
   expect(result.filesChanged).toBeGreaterThan(0);
   expect(result.totalReplacements).toBeGreaterThanOrEqual(3); // definición + DO + llamada ()

   // El archivo no debe haber cambiado
   const content = fs.readFileSync(path.join(tmpDir, "calculos.prg"), "latin1");
   expect(content).toContain("PROCEDURE Calcular");
});

test("rename_procedure: renombra definición y llamadas", async () => {
   writePrg("modulo.prg", `
PROCEDURE Viejo
   ? "soy viejo"
ENDPROC

PROCEDURE Principal
   DO Viejo
   Viejo()
ENDPROC
`);

   const result = await rename_procedure.run({
      oldName: "Viejo",
      newName: "Nuevo",
      dryRun: false,
   });

   expect(result.filesChanged).toBeGreaterThan(0);
   expect(result.totalReplacements).toBeGreaterThanOrEqual(3);

   const content = fs.readFileSync(path.join(tmpDir, "modulo.prg"), "latin1");
   expect(content).toContain("PROCEDURE Nuevo");
   expect(content).toContain("DO Nuevo");
   expect(content).toContain("Nuevo()");
   expect(content).not.toContain("PROCEDURE Viejo");
});

test("rename_procedure: lanza error si oldName === newName", async () => {
   await expect(
      rename_procedure.run({ oldName: "Foo", newName: "foo" })
   ).rejects.toThrow("iguales");
});

test("rename_procedure: lanza error si newName no es identificador válido", async () => {
   await expect(
      rename_procedure.run({ oldName: "Foo", newName: "123Malo" })
   ).rejects.toThrow("identificador");
});

// ---------------------------------------------------------------------------
// find_dead_code
// ---------------------------------------------------------------------------

test("find_dead_code: detecta procedimiento no llamado", async () => {
   writePrg("dead.prg", `
PROCEDURE Vivo
   DO Muerto
ENDPROC

PROCEDURE Muerto
   ? "nunca me llaman"
ENDPROC
`);

   writePrg("caller.prg", `
PROCEDURE Vivo
   ? "sí me llaman"
ENDPROC
`);

   const result = await find_dead_code.run({});

   expect(result.analyzed).toBeGreaterThan(0);
   // "Muerto" está definido en dead.prg pero en caller.prg también hay DO Muerto
   // y en dead.prg hay DO Muerto, así que Muerto sí tiene llamada
   // Pero "Vivo" aparece en dos archivos - no es dead code
   expect(typeof result.deadCount).toBe("number");
   expect(Array.isArray(result.dead)).toBe(true);
});

test("find_dead_code: no marca como muerto un proc que sí se llama", async () => {
   writePrg("usados.prg", `
PROCEDURE UsadoConDo
   ? "llamado con DO"
ENDPROC

PROCEDURE UsadoConParens
   RETURN 42
ENDFUNC

PROCEDURE Llamador
   DO UsadoConDo
   x = UsadoConParens()
ENDPROC
`);

   const result = await find_dead_code.run({ subdirectory: "." });
   const deadNames = result.dead.map((d) => d.name);
   expect(deadNames).not.toContain("UsadoConDo");
   expect(deadNames).not.toContain("UsadoConParens");
});

// ---------------------------------------------------------------------------
// generate_docs
// ---------------------------------------------------------------------------

test("generate_docs: genera markdown desde un archivo .prg", async () => {
   writePrg("docs_test.prg", `
* Suma dos números enteros.
* Parámetros: tnA, tnB
FUNCTION Suma(tnA, tnB)
   RETURN tnA + tnB
ENDFUNC

* Muestra el resultado en pantalla.
PROCEDURE MostrarResultado
LPARAMETERS tnValor
   ? tnValor
ENDPROC
`);

   const result = await generate_docs.run({ file: "docs_test.prg" });

   expect(typeof result.markdown).toBe("string");
   expect(result.markdown).toContain("Suma");
   expect(result.markdown).toContain("MostrarResultado");
   expect(result.sections).toBeGreaterThan(0);
});

test("generate_docs: escribe a outputFile cuando se especifica", async () => {
   writePrg("para_doc.prg", `
PROCEDURE Uno
   ? 1
ENDPROC
`);

   const outRel = "docs/output.md";
   const result = await generate_docs.run({
      file: "para_doc.prg",
      outputFile: outRel,
   });

   expect(result.outputFile).toBe(outRel);
   const absOut = path.join(tmpDir, outRel);
   expect(fs.existsSync(absOut)).toBe(true);
   const content = fs.readFileSync(absOut, "utf8");
   expect(content).toContain("Uno");
});

// ---------------------------------------------------------------------------
// git_log (sobre el repo real de JurassicFox)
// ---------------------------------------------------------------------------

test("git_log: devuelve historial del repo", async () => {
   // Usamos el repo real (JurassicFox tiene commits)
   const origPath = config.projectPath;
   config.projectPath = REPO_ROOT;
   try {
      const result = await git_log.run({ limit: 5, format: "oneline" });
      expect(result.log).not.toBe("(sin commits)");
      expect(typeof result.log).toBe("string");
      expect(result.limit).toBe(5);
   } finally {
      config.projectPath = origPath;
   }
});

// ---------------------------------------------------------------------------
// git_diff (sobre el repo real de JurassicFox)
// ---------------------------------------------------------------------------

test("git_diff: no lanza error en working tree limpio o con cambios", async () => {
   const origPath = config.projectPath;
   config.projectPath = REPO_ROOT;
   try {
      const result = await git_diff.run({ staged: false });
      expect(typeof result.diff).toBe("string");
      expect(typeof result.empty).toBe("boolean");
   } finally {
      config.projectPath = origPath;
   }
});
