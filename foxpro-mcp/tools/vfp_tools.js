/**
 * Fase 5 — Integración con el runtime de Visual FoxPro vía COM.
 *
 * Usa VBScript + cscript.exe como puente al objeto COM VisualFoxPro.Application.
 * No requiere módulos nativos (winax) ni compilación: funciona en cualquier
 * instalación de Windows con VFP9 y cscript disponibles.
 *
 * Cada herramienta lanza una instancia VFP, ejecuta el comando y la cierra.
 * El arranque tarda ~3-8 s según la máquina; es adecuado para compilar,
 * depurar y ejecutar fragmentos ocasionales. Para comandos frecuentes
 * considera una sesión persistente (Fase 5+).
 *
 * Requisitos:
 *   - VFP9 instalado (VisualFoxPro.Application registrado como servidor COM)
 *   - cscript.exe disponible (viene en todas las versiones de Windows)
 *   - VFP_VFP_EXE o VFP_PROJECT_PATH apuntan a la instalación
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, requireProjectPath, resolveSafe } from "../config.js";
import { logAudit, logError } from "../utils/logger.js";

// ProgID del servidor COM de VFP9
const VFP_PROG_ID = process.env.VFP_COM_PROGID || "VisualFoxPro.Application";
const DEFAULT_TIMEOUT_MS = Number(process.env.VFP_COM_TIMEOUT) || 60_000;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Escapa una cadena para insertarla como literal VBScript (entre comillas dobles).
 * Duplica las comillas dobles internas.
 */
function escVbs(str) {
   return String(str).replace(/"/g, '""');
}

/**
 * Escapa una ruta para usarla en un comando VFP (entre comillas simples).
 * VFP usa comillas simples para rutas en DO, COMPILE, SET DEFAULT TO.
 */
function escVfpPath(p) {
   return p.replace(/\\/g, "\\").replace(/'/g, "\\'");
}

/**
 * Genera un archivo .vbs temporal, lo ejecuta con cscript.exe y devuelve stdout.
 * Limpia el archivo aunque haya error.
 */
function runVbsFile(script, timeoutMs = DEFAULT_TIMEOUT_MS) {
   return new Promise((resolve, reject) => {
      const tmpPath = path.join(
         os.tmpdir(),
         `vfpmcp_${Date.now()}_${Math.random().toString(36).slice(2)}.vbs`
      );

      try {
         fs.writeFileSync(tmpPath, script, { encoding: "utf8" });
      } catch (e) {
         return reject(new Error(`No se pudo crear script temporal: ${e.message}`));
      }

      execFile(
         "cscript.exe",
         ["//Nologo", "//E:vbscript", tmpPath],
         { timeout: timeoutMs, encoding: "buffer", windowsHide: true },
         (err, stdout, stderr) => {
            try { fs.unlinkSync(tmpPath); } catch { /* ignorar */ }

            const out = stdout ? stdout.toString("cp1252").trim() : "";
            const errText = stderr ? stderr.toString("cp1252").trim() : "";

            if (err) {
               const msg = errText || err.message;
               reject(new Error(msg));
            } else {
               resolve({ stdout: out, stderr: errText });
            }
         }
      );
   });
}

/**
 * Construye y ejecuta un script VBScript que abre VFP vía COM,
 * ejecuta `vfpCommands` (string multilínea de VBScript que usa la variable `oVFP`)
 * y cierra VFP. Devuelve stdout.
 */
async function runWithVfp(vfpCommands, timeoutMs = DEFAULT_TIMEOUT_MS) {
   const projectPath = requireProjectPath();

   const script = `
Option Explicit
On Error GoTo ErrHandler

Dim oVFP
Set oVFP = CreateObject("${escVbs(VFP_PROG_ID)}")
oVFP.Visible = False
oVFP.AutoYield = False

oVFP.DoCmd "SET TALK OFF"
oVFP.DoCmd "SET NOTIFY OFF"
oVFP.DoCmd "SET SAFETY OFF"
oVFP.DoCmd "SET DEFAULT TO '${escVbs(escVfpPath(projectPath))}'"

${vfpCommands}

oVFP.Quit
WScript.Quit 0

ErrHandler:
WScript.StdErr.WriteLine "VBScript error " & Err.Number & ": " & Err.Description
If Not IsEmpty(oVFP) Then
  On Error Resume Next
  oVFP.Quit
End If
WScript.Quit 1
`;
   return runVbsFile(script, timeoutMs);
}

/**
 * Lee y parsea el archivo .err que VFP genera al compilar con errores.
 * Devuelve array de { line, column, message }.
 */
function parseErrFile(errPath) {
   if (!fs.existsSync(errPath)) return [];
   const content = fs.readFileSync(errPath, "latin1");
   const errors = [];
   // Formato típico VFP .err:
   //   Error en línea X columna Y: Mensaje
   //   o bien: X  Y  Mensaje
   const lines = content.split(/\r?\n/).filter(Boolean);
   for (const line of lines) {
      // Intenta formato "Número  Número  Texto"
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (m) {
         errors.push({ line: Number(m[1]), column: Number(m[2]), message: m[3].trim() });
      } else if (line.trim()) {
         errors.push({ line: null, column: null, message: line.trim() });
      }
   }
   return errors;
}

// ---------------------------------------------------------------------------
// run_vfp_command
// ---------------------------------------------------------------------------
export const run_vfp_command = {
   name: "run_vfp_command",
   title: "Ejecutar comando VFP vía COM",
   description:
      "Ejecuta uno o varios comandos Visual FoxPro usando el runtime VFP9 vía COM. " +
      "VFP arranca en modo invisible, ejecuta el comando y se cierra (~5-10 s de overhead). " +
      "Ideal para operaciones de mantenimiento, PACK, REINDEX, SET, etc. " +
      "Requiere VFP9 instalado con servidor COM registrado.",
   inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
         command: {
            type: "string",
            description:
               "Comando o comandos VFP a ejecutar (separados por Chr(13) o &&). " +
               "Ejemplo: 'USE CLIENTES EXCLUSIVE && PACK && USE'",
         },
         captureOutput: {
            type: "boolean",
            description:
               "Si true, ejecuta el comando con EVAL() y devuelve su resultado. " +
               "Útil para expresiones que retornan un valor. Default false.",
         },
         timeoutSeconds: {
            type: "number",
            description: "Tiempo máximo de espera en segundos. Default 60.",
         },
      },
   },
   async run({ command, captureOutput, timeoutSeconds }) {
      const timeout = (timeoutSeconds || 60) * 1000;
      let vfpBlock;

      if (captureOutput) {
         vfpBlock = `
Dim sResult
sResult = oVFP.Eval("${escVbs(command)}")
WScript.Echo sResult
`;
      } else {
         // Divide por líneas y llama DoCmd para cada una (omite vacías y comentarios)
         const lines = command
            .split(/\r?\n|&&/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("*") && !l.startsWith("&&"));

         vfpBlock = lines
            .map((l) => `oVFP.DoCmd "${escVbs(l)}"`)
            .join("\n");
      }

      const { stdout, stderr } = await runWithVfp(vfpBlock, timeout);

      logAudit("VFP_CMD", { command: command.slice(0, 200) });

      return {
         command,
         output: stdout || null,
         warnings: stderr || null,
         ok: true,
      };
   },
};

// ---------------------------------------------------------------------------
// eval_vfp_expression
// ---------------------------------------------------------------------------
export const eval_vfp_expression = {
   name: "eval_vfp_expression",
   title: "Evaluar expresión VFP",
   description:
      "Evalúa una expresión Visual FoxPro (usando EVAL()) y devuelve su resultado como string. " +
      "Ejemplos: 'DATE()', 'VERSION()', 'RECCOUNT(\"CLIENTES\")', etc.",
   inputSchema: {
      type: "object",
      required: ["expression"],
      properties: {
         expression: {
            type: "string",
            description: "Expresión VFP a evaluar. Debe devolver un valor escalar.",
         },
         openTable: {
            type: "string",
            description:
               "Ruta relativa a una tabla .dbf a abrir antes de evaluar (p.ej. para RECCOUNT()).",
         },
      },
   },
   async run({ expression, openTable }) {
      let prelude = "";
      if (openTable) {
         const absTable = resolveSafe(openTable);
         prelude = `oVFP.DoCmd "USE '${escVbs(escVfpPath(absTable))}'"\n`;
      }

      const vfpBlock = `
${prelude}
Dim sVal
sVal = oVFP.Eval("${escVbs(expression)}")
WScript.Echo sVal
`;

      const { stdout } = await runWithVfp(vfpBlock);
      return { expression, result: stdout };
   },
};

// ---------------------------------------------------------------------------
// compile_prg
// ---------------------------------------------------------------------------
export const compile_prg = {
   name: "compile_prg",
   title: "Compilar archivo .prg",
   description:
      "Compila un archivo .prg usando el compilador de VFP9 vía COM. " +
      "Devuelve lista de errores de compilación (línea, columna, mensaje) " +
      "o confirma que la compilación fue exitosa. " +
      "El archivo .fxp compilado se genera en la misma carpeta que el .prg.",
   inputSchema: {
      type: "object",
      required: ["file"],
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa al proyecto del .prg a compilar.",
         },
         deleteErrFile: {
            type: "boolean",
            description: "Eliminar el .err generado tras leerlo. Default true.",
         },
      },
   },
   async run({ file, deleteErrFile = true }) {
      const absPath = resolveSafe(file);
      if (!fs.existsSync(absPath)) {
         throw new Error(`Archivo no encontrado: ${file}`);
      }
      if (!/\.(prg|spr|mpr|qpr)$/i.test(absPath)) {
         throw new Error(`Solo se pueden compilar archivos .prg/.spr/.mpr/.qpr. Recibido: ${file}`);
      }

      const errPath = absPath.replace(/\.[^.]+$/, ".err");
      // Eliminar .err anterior para detectar errores nuevos
      if (fs.existsSync(errPath)) fs.unlinkSync(errPath);

      const vfpPath = escVbs(escVfpPath(absPath));

      // COMPILE escribe errores en .err y no lanza excepción COM; hay que leer .err
      const vfpBlock = `
On Error Resume Next
oVFP.DoCmd "COMPILE '${vfpPath}'"
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "COM error: " & Err.Description
End If
`;

      try {
         await runWithVfp(vfpBlock, 90_000);
      } catch (err) {
         // Error COM genérico; los errores de compilación van al .err
         logError("compile_prg", err);
      }

      const errors = parseErrFile(errPath);

      if (deleteErrFile && fs.existsSync(errPath)) {
         try { fs.unlinkSync(errPath); } catch { /* ignorar */ }
      }

      const fxpPath = absPath.replace(/\.[^.]+$/, ".fxp");
      const compiled = fs.existsSync(fxpPath);

      logAudit("COMPILE", { file, errors: errors.length, ok: errors.length === 0 });

      return {
         file,
         success: errors.length === 0,
         compiled,
         errorCount: errors.length,
         errors,
      };
   },
};

// ---------------------------------------------------------------------------
// run_prg
// ---------------------------------------------------------------------------
export const run_prg = {
   name: "run_prg",
   title: "Ejecutar archivo .prg",
   description:
      "Ejecuta un archivo .prg usando DO <file> dentro de VFP vía COM. " +
      "Captura el output producido por ? / ?? y MESSAGEBOX si es posible. " +
      "Útil para probar programas auxiliares, scripts de datos, etc. " +
      "No ejecuta programas que abran formularios (SCREEN/FORM) interactivos.",
   inputSchema: {
      type: "object",
      required: ["file"],
      properties: {
         file: {
            type: "string",
            description: "Ruta relativa al proyecto del .prg a ejecutar.",
         },
         parameters: {
            type: "string",
            description:
               "Parámetros a pasar al programa (como string VFP, p.ej. '\"hola\", 42').",
         },
         timeoutSeconds: {
            type: "number",
            description: "Tiempo máximo de espera en segundos. Default 30.",
         },
      },
   },
   async run({ file, parameters, timeoutSeconds }) {
      const absPath = resolveSafe(file);
      if (!fs.existsSync(absPath)) {
         throw new Error(`Archivo no encontrado: ${file}`);
      }

      const timeout = (timeoutSeconds || 30) * 1000;
      const vfpPath = escVbs(escVfpPath(absPath));
      const paramsStr = parameters ? ` WITH ${escVbs(parameters)}` : "";

      // Redirigimos ? / ?? a un archivo temporal leyéndolo después
      const outFile = path.join(os.tmpdir(), `vfpmcp_out_${Date.now()}.txt`);

      const vfpBlock = `
On Error Resume Next
oVFP.DoCmd "SET PRINT TO '${escVbs(escVfpPath(outFile))}'"
oVFP.DoCmd "SET PRINT ON"
oVFP.DoCmd "DO '${vfpPath}'${paramsStr}"
oVFP.DoCmd "SET PRINT OFF"
oVFP.DoCmd "SET PRINT TO"
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "VFP error " & Err.Number & ": " & Err.Description
End If
`;

      let vfpStderr = "";
      try {
         const res = await runWithVfp(vfpBlock, timeout);
         vfpStderr = res.stderr || "";
      } catch (err) {
         logError("run_prg", err);
         return { file, ok: false, error: err.message, output: null };
      }

      let output = null;
      if (fs.existsSync(outFile)) {
         try {
            output = fs.readFileSync(outFile, "latin1").trim() || null;
            fs.unlinkSync(outFile);
         } catch { /* ignorar */ }
      }

      logAudit("RUN_PRG", { file, ok: !vfpStderr });

      return {
         file,
         ok: !vfpStderr,
         output,
         error: vfpStderr || null,
      };
   },
};

export const vfpTools = [
   run_vfp_command,
   eval_vfp_expression,
   compile_prg,
   run_prg,
];
