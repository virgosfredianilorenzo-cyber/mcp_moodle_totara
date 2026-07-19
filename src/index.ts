import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import winston from "winston";
import { MoodleClient } from "./moodleClient.js";

// Imports des outils
import * as coursesTools from "./tools/courses.js";
import * as usersTools from "./tools/users.js";
import * as enrolmentTools from "./tools/enrolments.js";
import * as gradesTools from "./tools/grades.js";
import * as scormTools from "./tools/scorm.js";
import * as reportTools from "./tools/reports.js";

// Charge les variables d'environnement
dotenv.config();

// Configure les logs
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "mcp-server.log" }),
  ],
});

// Vérifie que les variables obligatoires sont présentes
if (!process.env.MOODLE_URL || !process.env.MOODLE_TOKEN) {
  logger.error("❌ Erreur : MOODLE_URL et MOODLE_TOKEN doivent être définis dans .env");
  process.exit(1);
}

// Initialise le client Moodle
const moodleClient = new MoodleClient(
  process.env.MOODLE_URL,
  process.env.MOODLE_TOKEN
);

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
      inputSchema: tool.inputSchema,
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

// Démarre le serveur
logger.info("🚀 Démarrage du serveur MCP pour Moodle...");
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  logger.error("❌ Erreur du serveur MCP :", error);
  process.exit(1);
});
