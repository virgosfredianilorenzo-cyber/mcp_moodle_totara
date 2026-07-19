import crypto from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import dotenv from "dotenv";
import winston from "winston";
import { MoodleClient } from "./moodleClient.js";
import { createMcpServer } from "./server.js";

// Charge les variables d'environnement
dotenv.config();

// Configure les logs (Console autorisée ici : pas de contrainte stdio JSON-RPC en HTTP)
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

if (!process.env.MCP_ACCESS_TOKEN) {
  logger.error("❌ Erreur : MCP_ACCESS_TOKEN doit être défini dans .env pour démarrer le serveur HTTP.");
  process.exit(1);
}

const accessToken = process.env.MCP_ACCESS_TOKEN;

// Initialise le client Moodle
const moodleClient = new MoodleClient(
  process.env.MOODLE_URL,
  process.env.MOODLE_TOKEN
);

function isAuthorized(req: express.Request): boolean {
  const provided = typeof req.query.token === "string" ? req.query.token : "";
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(accessToken);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

function unauthorizedResponse(res: express.Response) {
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Non autorisé : token manquant ou invalide.",
    },
    id: null,
  });
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  if (!isAuthorized(req)) {
    logger.warn("Requête HTTP refusée (token invalide)", { ip: req.ip });
    unauthorizedResponse(res);
    return;
  }

  const server = createMcpServer(moodleClient, logger);
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    logger.error("❌ Erreur du serveur MCP HTTP :", error as any);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  logger.info(`🚀 Serveur MCP HTTP pour Moodle démarré sur le port ${port}`);
});
