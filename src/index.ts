import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import winston from "winston";
import { MoodleClient } from "./moodleClient.js";
import { createMcpServer } from "./server.js";

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
    // Pas de transport Console : le stdout est réservé au protocole JSON-RPC MCP.
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

// Crée le serveur MCP
const server = createMcpServer(moodleClient, logger);

// Démarre le serveur
logger.info("🚀 Démarrage du serveur MCP pour Moodle (stdio)...");
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  logger.error("❌ Erreur du serveur MCP :", error);
  process.exit(1);
});
