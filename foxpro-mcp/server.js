#!/usr/bin/env node
/**
 * Servidor MCP para integraci n FoxPro + Claude.
 *
 * Comunicaci n por STDIO (configurado en claude_desktop_config.json).
 * Registra herramientas para inspeccionar y modificar c digo .prg y consultar tablas .dbf.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
   CallToolRequestSchema,
   ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { config } from "./config.js";
import { logError, logInfo, stderr } from "./utils/logger.js";
import { fileTools } from "./tools/file_tools.js";
import { dbfTools } from "./tools/dbf_tools.js";

const SERVER_INFO = {
   name: "foxpro-mcp",
   version: "0.1.0",
};

const ALL_TOOLS = [...fileTools, ...dbfTools];
const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

function formatToolListing() {
   return ALL_TOOLS.map((t) => ({
      name: t.name,
      title: t.title || t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: "object", properties: {} },
   }));
}

function toolResultText(value) {
   if (value === undefined || value === null) {
      return { content: [{ type: "text", text: "(sin resultado)" }] };
   }
   if (typeof value === "string") {
      return { content: [{ type: "text", text: value }] };
   }
   return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
   };
}

function toolResultError(err) {
   const message = err && err.message ? err.message : String(err);
   return {
      isError: true,
      content: [{ type: "text", text: `ERROR: ${message}` }],
   };
}

async function main() {
   const server = new Server(SERVER_INFO, {
      capabilities: {
         tools: {},
         logging: {},
      },
   });

   server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: formatToolListing() };
   });

   server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) {
         return toolResultError(new Error(`Herramienta desconocida: ${name}`));
      }
      try {
         const result = await tool.run(args || {});
         return toolResultText(result);
      } catch (err) {
         logError(`tool:${name}`, err);
         return toolResultError(err);
      }
   });

   const transport = new StdioServerTransport();
   await server.connect(transport);

   const projectPath = config.projectPath || "(no configurado: define VFP_PROJECT_PATH)";
   stderr(`[foxpro-mcp] Servidor MCP iniciado. Proyecto: ${projectPath}`);
   stderr(`[foxpro-mcp] Herramientas registradas: ${ALL_TOOLS.map((t) => t.name).join(", ")}`);
   logInfo(`Servidor MCP iniciado. Project: ${projectPath}`);
}

main().catch((err) => {
   stderr(`[foxpro-mcp] Error fatal: ${err.message}`);
   stderr(err.stack || "");
   process.exit(1);
});
