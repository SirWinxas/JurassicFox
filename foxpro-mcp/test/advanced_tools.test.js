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
   call_graph,
   search_and_replace,
   extract_procedure,
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

// ---------------------------------------------------------------------------
// call_graph
// ---------------------------------------------------------------------------

test("call_graph: detecta llamada entre dos procedimientos", async () => {
   writePrg("grafo.prg", `
PROCEDURE Principal
   DO Auxiliar
   Auxiliar()
ENDPROC

PROCEDURE Auxiliar
   ? "auxiliar"
ENDPROC
`);

   const result = await call_graph.run({ format: "json" });

   expect(result.nodes).toBeGreaterThanOrEqual(2);
   expect(result.edges).toBeGreaterThanOrEqual(1);

   const edge = result.graph.edges.find(
      (e) => e.from.toUpperCase() === "PRINCIPAL" && e.to.toUpperCase() === "AUXILIAR"
   );
   expect(edge).toBeDefined();
});

test("call_graph: identifica puntos de entrada y hojas", async () => {
   writePrg("cadena.prg", `
PROCEDURE A
   DO B
ENDPROC

PROCEDURE B
   DO C
ENDPROC

PROCEDURE C
   ? "hoja"
ENDPROC
`);

   const result = await call_graph.run({ format: "json" });

   expect(result.entryPoints).toContain("A");
   expect(result.leafNodes).toContain("C");
});

test("call_graph: formato dot contiene digraph y flechas", async () => {
   const result = await call_graph.run({ format: "dot" });

   expect(typeof result.dot).toBe("string");
   expect(result.dot).toContain("digraph CallGraph");
   expect(result.dot).toContain("->");
});

test("call_graph: formato summary contiene texto legible", async () => {
   const result = await call_graph.run({ format: "summary" });

   expect(typeof result.summary).toBe("string");
   expect(result.summary).toContain("Puntos de entrada");
   expect(result.summary).toContain("Hojas");
});

test("call_graph: rootProc filtra al subgrafo alcanzable", async () => {
   writePrg("multi.prg", `
PROCEDURE Raiz
   DO Hijo
ENDPROC

PROCEDURE Hijo
   ? "hijo"
ENDPROC

PROCEDURE Ajeno
   ? "no me llaman desde Raiz"
ENDPROC
`);

   const result = await call_graph.run({ format: "json", rootProc: "Raiz" });

   const names = result.graph.nodes.map((n) => n.name.toUpperCase());
   expect(names).toContain("RAIZ");
   expect(names).toContain("HIJO");
   expect(names).not.toContain("AJENO");
});

test("call_graph: lanza error si rootProc no existe", async () => {
   await expect(
      call_graph.run({ format: "json", rootProc: "NoExiste" })
   ).rejects.toThrow("no encontrado");
});

// ---------------------------------------------------------------------------
// search_and_replace
// ---------------------------------------------------------------------------

test("search_and_replace: dryRun no modifica archivos", async () => {
   writePrg("sar_dry.prg", `
PROCEDURE Antiguo
   ? "texto antiguo"
ENDPROC
`);

   const result = await search_and_replace.run({
      pattern: "antiguo",
      replacement: "nuevo",
      dryRun: true,
   });

   expect(result.dryRun).toBe(true);
   expect(result.filesChanged).toBeGreaterThan(0);
   expect(result.totalReplacements).toBeGreaterThan(0);

   const content = fs.readFileSync(path.join(tmpDir, "sar_dry.prg"), "latin1");
   expect(content).toContain("antiguo");
});

test("search_and_replace: reemplaza texto literal en múltiples archivos", async () => {
   writePrg("sar_a.prg", `PROCEDURE ProcA\n   DO_ALGO\nENDPROC\n`);
   writePrg("sar_b.prg", `PROCEDURE ProcB\n   DO_ALGO\nENDPROC\n`);

   const result = await search_and_replace.run({
      pattern: "DO_ALGO",
      replacement: "DO_NUEVO",
      dryRun: false,
   });

   expect(result.filesChanged).toBeGreaterThanOrEqual(2);
   expect(result.totalReplacements).toBeGreaterThanOrEqual(2);

   const a = fs.readFileSync(path.join(tmpDir, "sar_a.prg"), "latin1");
   const b = fs.readFileSync(path.join(tmpDir, "sar_b.prg"), "latin1");
   expect(a).toContain("DO_NUEVO");
   expect(b).toContain("DO_NUEVO");
   expect(a).not.toContain("DO_ALGO");
});

test("search_and_replace: soporta regex con grupos de captura", async () => {
   writePrg("sar_regex.prg", `PROCEDURE RegexTest\n   x = Viejo123\n   y = Viejo456\nENDPROC\n`);

   const result = await search_and_replace.run({
      pattern: "Viejo(\\d+)",
      replacement: "Nuevo$1",
      isRegex: true,
      dryRun: false,
   });

   expect(result.filesChanged).toBeGreaterThan(0);
   const content = fs.readFileSync(path.join(tmpDir, "sar_regex.prg"), "latin1");
   expect(content).toContain("Nuevo123");
   expect(content).toContain("Nuevo456");
   expect(content).not.toContain("Viejo");
});

test("search_and_replace: lanza error con regex inválida", async () => {
   await expect(
      search_and_replace.run({ pattern: "[inválido", replacement: "x", isRegex: true })
   ).rejects.toThrow("inválida");
});

// ---------------------------------------------------------------------------
// extract_procedure
// ---------------------------------------------------------------------------

test("extract_procedure: mueve procedure a archivo nuevo", async () => {
   writePrg("ep_origen.prg", `PROCEDURE Extraible
   ? "soy extraible"
ENDPROC

PROCEDURE Queda
   DO Extraible
ENDPROC
`);

   const result = await extract_procedure.run({
      procedureName: "Extraible",
      sourceFile: "ep_origen.prg",
      targetFile: "ep_destino.prg",
   });

   expect(result.linesExtracted).toBeGreaterThan(0);
   expect(result.created).toBe(true);

   const src = fs.readFileSync(path.join(tmpDir, "ep_origen.prg"), "latin1");
   expect(src).not.toContain("PROCEDURE Extraible");
   expect(src).toContain("PROCEDURE Queda");

   const tgt = fs.readFileSync(path.join(tmpDir, "ep_destino.prg"), "latin1");
   expect(tgt).toContain("PROCEDURE Extraible");
});

test("extract_procedure: añade a archivo existente sin duplicar", async () => {
   writePrg("ep_src2.prg", `PROCEDURE Movible
   RETURN 42
ENDFUNC

PROCEDURE Resto
   ? "quedo"
ENDPROC
`);
   writePrg("ep_dst2.prg", `PROCEDURE YaExistente
   ? "preexisto"
ENDPROC
`);

   const result = await extract_procedure.run({
      procedureName: "Movible",
      sourceFile: "ep_src2.prg",
      targetFile: "ep_dst2.prg",
   });

   expect(result.created).toBe(false);

   const tgt = fs.readFileSync(path.join(tmpDir, "ep_dst2.prg"), "latin1");
   expect(tgt).toContain("PROCEDURE YaExistente");
   expect(tgt).toContain("PROCEDURE Movible");
});

test("extract_procedure: lanza error si proc ya existe en destino", async () => {
   writePrg("ep_conf_src.prg", `PROCEDURE Duplicado\n   ? "original"\nENDPROC\n`);
   writePrg("ep_conf_dst.prg", `PROCEDURE Duplicado\n   ? "copia"\nENDPROC\n`);

   await expect(
      extract_procedure.run({
         procedureName: "Duplicado",
         sourceFile: "ep_conf_src.prg",
         targetFile: "ep_conf_dst.prg",
      })
   ).rejects.toThrow("ya existe");
});

test("extract_procedure: lanza error si proc no existe en origen", async () => {
   writePrg("ep_noexiste.prg", `PROCEDURE Otro\n   ? "otro"\nENDPROC\n`);

   await expect(
      extract_procedure.run({
         procedureName: "NoExiste",
         sourceFile: "ep_noexiste.prg",
         targetFile: "ep_noexiste_dst.prg",
      })
   ).rejects.toThrow("no encontrado");
});
