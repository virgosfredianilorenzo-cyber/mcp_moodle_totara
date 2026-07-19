import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import winston from "winston";
import { MoodleClient } from "./moodleClient.ts";

// Imports des outils (extensions .ts)
import * as coursesTools from "./tools/courses.ts";
import * as usersTools from "./tools/users.ts";
import * as enrolmentTools from "./tools/enrolments.ts";
import * as gradesTools from "./tools/grades.ts";
import * as scormTools from "./tools/scorm.ts";
import * as reportTools from "./tools/reports.ts";

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

// Définis le gestionnaire de requêtes
server.setRequestHandler(
  {} as any, // Schéma vide (on gère la validation manuellement)
  async (request: ServerRequest) => {
    // Log la requête
    logger.info(`Requête MCP reçue : ${(request as any).method}`, {
      tool: (request as any).params?.name,
      timestamp: new Date().toISOString(),
    });

    // Liste des outils disponibles
    if (ListToolsRequestSchema.parse(request)) {
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    }

    // Appel d'un outil
    if (CallToolRequestSchema.parse(request)) {
      const tool = tools.find((t) => t.name === (request as any).params.name);
      if (!tool) {
        throw new Error(`Outil "${(request as any).params.name}" introuvable.`);
      }
      try {
        const result = await tool.handler((request as any).params.arguments, moodleClient);
        logger.info(`Outil "${tool.name}" exécuté avec succès.`);
        return result;
      } catch (error) {
        logger.error(`Erreur dans l'outil "${tool.name}" : ${String(error)}`);
        throw error;
      }
    }

    // Requête non reconnue
    throw new Error(`Type de requête inconnu : ${(request as any).method}`);
  }
);

// Démarre le serveur
logger.info("🚀 Démarrage du serveur MCP pour Moodle...");
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  logger.error("❌ Erreur du serveur MCP :", error);
  process.exit(1);
});
