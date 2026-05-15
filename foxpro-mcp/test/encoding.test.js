import { test, expect } from "bun:test";
import { encode, decode, codepageToEncoding, detectEncoding } from "../utils/encoding.js";

test("encode/decode roundtrip CP1252", () => {
   const original = "Hola  o   Espa a";
   const buf = encode(original, "cp1252");
   const back = decode(buf, "cp1252");
   expect(back).toBe(original);
});

test("codepageToEncoding mapea bytes conocidos", () => {
   expect(codepageToEncoding(0x03)).toBe("cp1252");
   expect(codepageToEncoding(0x02)).toBe("cp850");
   expect(codepageToEncoding(0xC9)).toBe("cp1251");
});

test("codepageToEncoding cae a cp1252 por defecto", () => {
   expect(codepageToEncoding(0xFF)).toBe("cp1252");
});

test("detectEncoding identifica CP1252 con caracteres ANSI", () => {
   const text = "Acci n y reducci n";
   const buf = encode(text, "cp1252");
   const detected = detectEncoding(buf);
   expect(detected).toBe("cp1252");
});

test("detectEncoding identifica OEM con caracteres box-drawing", () => {
   const buf = Buffer.from([0xC9, 0xCD, 0xCD, 0xBB, 0xBA, 0x20, 0xBA, 0xC8, 0xCD, 0xCD, 0xBC]);
   const detected = detectEncoding(buf);
   expect(detected).toBe("cp850");
});
