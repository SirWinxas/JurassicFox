/**
 * Parser ligero de sintaxis Visual FoxPro.
 * No es un parser completo: extrae lo útil para indexar y entender estructura
 * (PROCEDURE/FUNCTION/DEFINE CLASS/PARAMETERS/comentarios de cabecera).
 *
 * VFP es case-insensitive; las comparaciones se hacen sobre el texto en
 * mayúsculas, pero se preserva la versión original para mostrarla.
 */

const RE_PROC = /^\s*(PROCEDURE|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/i;
const RE_END_PROC = /^\s*(ENDPROC|ENDFUNC)\b/i;
const RE_CLASS = /^\s*DEFINE\s+CLASS\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:AS|OF)\s+([A-Za-z_][A-Za-z0-9_]*))?/i;
const RE_END_CLASS = /^\s*ENDDEFINE\b/i;
const RE_PARAMETERS = /^\s*(?:LPARAMETERS|PARAMETERS)\s+(.+)$/i;
const RE_COMMENT_LINE = /^\s*(?:\*|&&)(.*)$/;
const RE_INLINE_COMMENT = /&&(.*)$/;

/**
 * Une líneas continuadas por ";" (continuación VFP).
 * Devuelve un array de {logicalLine, startLine, endLine}.
 */
function joinContinuationLines(rawLines) {
   const result = [];
   let buffer = "";
   let startLine = -1;

   for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      // Para detectar continuación hay que ignorar comentarios inline
      const codePart = line.replace(RE_INLINE_COMMENT, "");
      const trimmed = codePart.trimEnd();
      const isContinuation = trimmed.endsWith(";");

      if (buffer === "") startLine = i + 1;

      if (isContinuation) {
         buffer += trimmed.slice(0, -1) + " ";
      } else {
         buffer += line;
         result.push({ logicalLine: buffer, startLine, endLine: i + 1 });
         buffer = "";
         startLine = -1;
      }
   }
   if (buffer !== "") {
      result.push({ logicalLine: buffer, startLine, endLine: rawLines.length });
   }
   return result;
}

/**
 * Captura los comentarios contiguos inmediatamente anteriores a startLine.
 * Devuelve un string limpio (sin los '*' o '&&' iniciales).
 */
function captureLeadingComment(rawLines, startLine) {
   const collected = [];
   for (let i = startLine - 2; i >= 0; i--) {
      const line = rawLines[i];
      const m = line.match(RE_COMMENT_LINE);
      if (m) {
         collected.unshift(m[1].trim());
      } else if (line.trim() === "") {
         if (collected.length > 0) break; // línea en blanco corta el bloque
      } else {
         break;
      }
   }
   return collected.join("\n").trim();
}

/**
 * Parsea el contenido de un archivo .prg.
 * Devuelve: { procedures, classes, parameters }
 */
export function parsePrg(content) {
   const rawLines = content.split(/\r?\n/);
   const logical = joinContinuationLines(rawLines);

   const procedures = [];
   const classes = [];
   let topParameters = null;

   let currentProc = null;
   let currentClass = null;

   for (const entry of logical) {
      const { logicalLine, startLine, endLine } = entry;

      // Saltamos comentarios puros
      if (RE_COMMENT_LINE.test(logicalLine)) continue;

      // PARAMETERS / LPARAMETERS al nivel actual
      const mParams = logicalLine.match(RE_PARAMETERS);
      if (mParams) {
         const paramsList = mParams[1]
            .replace(RE_INLINE_COMMENT, "")
            .trim()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
         if (currentProc) {
            currentProc.parameters = paramsList;
         } else if (currentClass) {
            // Parámetros de clase no son habituales, pero los guardamos por si acaso
         } else if (topParameters === null) {
            topParameters = paramsList;
         }
         continue;
      }

      // DEFINE CLASS
      const mClass = logicalLine.match(RE_CLASS);
      if (mClass && !currentClass) {
         currentClass = {
            name: mClass[1],
            baseClass: mClass[2] || null,
            startLine,
            endLine: null,
            methods: [],
            comment: captureLeadingComment(rawLines, startLine),
         };
         continue;
      }

      if (RE_END_CLASS.test(logicalLine) && currentClass) {
         currentClass.endLine = endLine;
         classes.push(currentClass);
         currentClass = null;
         continue;
      }

      // PROCEDURE / FUNCTION
      const mProc = logicalLine.match(RE_PROC);
      if (mProc) {
         // Si est bamos en un proc abierto y no se cierra expl citamente, lo cerramos aqu .
         if (currentProc && !currentProc.endLine) {
            currentProc.endLine = startLine - 1;
            if (currentClass) {
               currentClass.methods.push(currentProc);
            } else {
               procedures.push(currentProc);
            }
            currentProc = null;
         }

         const inlineParams = mProc[3]
            ? mProc[3].split(",").map((s) => s.trim()).filter(Boolean)
            : [];

         currentProc = {
            kind: mProc[1].toUpperCase() === "FUNCTION" ? "FUNCTION" : "PROCEDURE",
            name: mProc[2],
            parameters: inlineParams,
            startLine,
            endLine: null,
            comment: captureLeadingComment(rawLines, startLine),
            insideClass: currentClass ? currentClass.name : null,
         };
         continue;
      }

      if (RE_END_PROC.test(logicalLine) && currentProc) {
         currentProc.endLine = endLine;
         if (currentClass) {
            currentClass.methods.push(currentProc);
         } else {
            procedures.push(currentProc);
         }
         currentProc = null;
         continue;
      }
   }

   // Cerrar procedimiento abierto al final
   if (currentProc) {
      currentProc.endLine = rawLines.length;
      if (currentClass) {
         currentClass.methods.push(currentProc);
      } else {
         procedures.push(currentProc);
      }
   }
   if (currentClass) {
      currentClass.endLine = rawLines.length;
      classes.push(currentClass);
   }

   return {
      parameters: topParameters,
      procedures,
      classes,
   };
}

/**
 * Busca todas las llamadas a un identificador (procedimiento/función).
 * Heurística: el nombre seguido de "(" o como parámetro de DO.
 */
export function findCalls(content, name) {
   const lines = content.split(/\r?\n/);
   const reCall = new RegExp(
      `(?:\\bDO\\s+${escapeRegex(name)}\\b|\\b${escapeRegex(name)}\\s*\\()`,
      "gi"
   );
   const calls = [];
   for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Saltar líneas que sean solo comentarios
      if (RE_COMMENT_LINE.test(line)) continue;
      // Quitar comentarios inline para no contar
      const code = line.replace(RE_INLINE_COMMENT, "");
      if (reCall.test(code)) {
         calls.push({ line: i + 1, text: line.trim() });
         reCall.lastIndex = 0;
      }
   }
   return calls;
}

function escapeRegex(s) {
   return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
