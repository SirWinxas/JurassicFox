import { test, expect } from "bun:test";
import { parsePrg, findCalls } from "../utils/foxpro_parser.js";

test("parsePrg: detecta PROCEDURE simple", () => {
   const src = `
PROCEDURE Saluda
LPARAMETERS tcNombre
   ? "Hola " + tcNombre
ENDPROC
`;
   const r = parsePrg(src);
   expect(r.procedures.length).toBe(1);
   expect(r.procedures[0].name).toBe("Saluda");
   expect(r.procedures[0].kind).toBe("PROCEDURE");
   expect(r.procedures[0].parameters).toEqual(["tcNombre"]);
});

test("parsePrg: detecta FUNCTION con parámetros inline", () => {
   const src = `
FUNCTION Suma(tnA, tnB)
   RETURN tnA + tnB
ENDFUNC
`;
   const r = parsePrg(src);
   expect(r.procedures.length).toBe(1);
   expect(r.procedures[0].name).toBe("Suma");
   expect(r.procedures[0].kind).toBe("FUNCTION");
   expect(r.procedures[0].parameters).toEqual(["tnA", "tnB"]);
});

test("parsePrg: captura comentario de cabecera", () => {
   const src = `
* Esta es la cabecera
* Multi-línea
PROCEDURE Test
   ? "x"
ENDPROC
`;
   const r = parsePrg(src);
   expect(r.procedures[0].comment).toContain("cabecera");
   expect(r.procedures[0].comment).toContain("Multi-línea");
});

test("parsePrg: DEFINE CLASS con métodos", () => {
   const src = `
DEFINE CLASS MiClase AS Custom
   nValor = 0

   PROCEDURE Init
      THIS.nValor = 10
   ENDPROC

   FUNCTION GetValor
      RETURN THIS.nValor
   ENDFUNC
ENDDEFINE
`;
   const r = parsePrg(src);
   expect(r.classes.length).toBe(1);
   expect(r.classes[0].name).toBe("MiClase");
   expect(r.classes[0].baseClass).toBe("Custom");
   expect(r.classes[0].methods.length).toBe(2);
});

test("parsePrg: continuación con ; en parámetros", () => {
   const src = `
FUNCTION LargoFunc
LPARAMETERS tcUno, ;
            tcDos, ;
            tcTres
   RETURN tcUno + tcDos + tcTres
ENDFUNC
`;
   const r = parsePrg(src);
   expect(r.procedures.length).toBe(1);
   expect(r.procedures[0].parameters).toEqual(["tcUno", "tcDos", "tcTres"]);
});

test("parsePrg: m ltiples procedimientos", () => {
   const src = `
PROCEDURE Uno
ENDPROC

FUNCTION Dos
ENDFUNC

PROCEDURE Tres
ENDPROC
`;
   const r = parsePrg(src);
   expect(r.procedures.length).toBe(3);
   expect(r.procedures.map(p => p.name)).toEqual(["Uno", "Dos", "Tres"]);
});

test("parsePrg: PARAMETERS a nivel de archivo", () => {
   const src = `
LPARAMETERS tcParam1, tnParam2
? "Comienza el script"
`;
   const r = parsePrg(src);
   expect(r.parameters).toEqual(["tcParam1", "tnParam2"]);
});

test("findCalls: encuentra llamadas a función", () => {
   const src = `
PROCEDURE Principal
   Suma(1, 2)
   DO OtraProc
   * comentario que no cuenta: Suma(99)
   x = Suma(3, 4) && Suma comentado no cuenta
ENDPROC
`;
   const calls = findCalls(src, "Suma");
   expect(calls.length).toBe(2);
});

test("parsePrg: case insensitive en palabras clave", () => {
   const src = `
procedure abc
lparameters x
endproc
`;
   const r = parsePrg(src);
   expect(r.procedures.length).toBe(1);
   expect(r.procedures[0].name).toBe("abc");
});
