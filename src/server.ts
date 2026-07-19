import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import winston from "winston";
import { zodToJsonSchema } from "zod-to-json-schema";
import { MoodleClient } from "./moodleClient.js";

// Imports des outils
import * as coursesTools from "./tools/courses.js";
import * as usersTools from "./tools/users.js";
import * as enrolmentTools from "./tools/enrolments.js";
import * as gradesTools from "./tools/grades.js";
import * as scormTools from "./tools/scorm.js";
import * as reportTools from "./tools/reports.js";

export function createMcpServer(moodleClient: MoodleClient, logger: winston.Logger): Server {
  // Liste de tous les outils MCP
  const tools = [
    // Outils de base
    coursesTools.getCourses,
    usersTools.getUsers,
    enrolmentTools.getEnrolledUsers,
    gradesTools.getGradeItems,

    // Outils SCORM
    scormTools.getScormsByCourses,
    scormTools.getScormCompletionReport,

    // Outils Reporting
    reportTools.getCompletionReport,
  ];

  // Crée le serveur MCP
  const server = new Server(
    {
      name: "moodle-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Liste des outils disponibles
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info("Requête MCP reçue : tools/list");
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  });

  // Appel d'un outil
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    logger.info(`Requête MCP reçue : tools/call`, {
      tool: toolName,
      timestamp: new Date().toISOString(),
    });

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Outil "${toolName}" introuvable.`);
    }
    try {
      const result = await tool.handler(request.params.arguments as any, moodleClient);
      logger.info(`Outil "${tool.name}" exécuté avec succès.`);
      return result;
    } catch (error) {
      logger.error(`Erreur dans l'outil "${tool.name}" : ${String(error)}`);
      throw error;
    }
  });

  return server;
}
