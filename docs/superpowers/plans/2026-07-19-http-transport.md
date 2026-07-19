# HTTP Transport for Moodle MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Streamable HTTP entry point to the Moodle MCP server, alongside the existing stdio entry point, protected by a static bearer-style token passed as a URL query parameter, so the server can be added as a claude.ai custom connector once deployed.

**Architecture:** Extract the existing tool list + MCP request handlers from `src/index.ts` into a shared `src/server.ts` factory function `createMcpServer(moodleClient)`. `src/index.ts` (stdio) and a new `src/httpServer.ts` (Streamable HTTP via Express, stateless mode) both call this factory, so tool wiring lives in exactly one place.

**Tech Stack:** TypeScript (NodeNext), `@modelcontextprotocol/sdk` (`Server`, `StreamableHTTPServerTransport`), Express 5 (already a transitive dep of the SDK), winston (existing logger), `tsx` for dev.

## Global Constraints

- Existing stdio behavior (`src/index.ts`) must not change observably — same tool list, same logging.
- HTTP mode must refuse to start if `MCP_ACCESS_TOKEN` is not set (no unauthenticated fallback).
- Token comparison must use `crypto.timingSafeEqual`, not `===`.
- HTTP transport runs in **stateless** mode (`sessionIdGenerator: undefined`) — no session storage.
- `GET /mcp` and `DELETE /mcp` return `405`.
- Deployment (Docker, systemd, reverse proxy, TLS) is out of scope for this plan.
- No automated test suite exists in this project (`npm test` is a placeholder) — validation here is manual via `curl`, matching the project's current state.

---

### Task 1: Extract shared server factory into `src/server.ts`

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `export function createMcpServer(moodleClient: MoodleClient): Server` — importable by both `src/index.ts` and the future `src/httpServer.ts`. Takes an already-constructed `MoodleClient` (see `src/moodleClient.ts:4` constructor `(baseUrl: string, token: string)`); does not read env vars or construct its own client.

- [ ] **Step 1: Create `src/server.ts` with the extracted factory**

```ts
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
```

- [ ] **Step 2: Rewrite `src/index.ts` to use the factory**

Replace the full contents of `src/index.ts` with:

```ts
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
```

- [ ] **Step 3: Verify the stdio server still builds and starts**

Run: `npm run build`
Expected: compiles with no TypeScript errors, `dist/server.js` and `dist/index.js` created.

Run: `MOODLE_URL=https://example.com/webservice/rest/server.php MOODLE_TOKEN=test timeout 2 npm run dev 2>&1 | tail -5; echo "exit code: $?"`
Expected: no thrown errors before the timeout kills it (a clean stdio server sits waiting for input — timeout exiting with code 124 is success; a stack trace is failure).

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "$(cat <<'EOF'
Extract MCP server factory into src/server.ts

Pulls tool registration and request handlers out of index.ts so both
the existing stdio transport and the upcoming HTTP transport can share
the same server construction logic.
EOF
)"
```

---

### Task 2: Add Streamable HTTP entry point with token auth

**Files:**
- Create: `src/httpServer.ts`
- Modify: `package.json` (scripts + dependencies)

**Interfaces:**
- Consumes: `createMcpServer(moodleClient: MoodleClient, logger: winston.Logger): Server` from Task 1 (`src/server.ts`).
- Consumes: `MoodleClient` constructor `(baseUrl: string, token: string)` from `src/moodleClient.ts:4`.
- Produces: an executable file `src/httpServer.ts` listening on `POST /mcp` (plus `405` on `GET`/`DELETE /mcp`), runnable via `npm run dev:http` / `npm run start:http`.

- [ ] **Step 1: Add `express` as a direct dependency**

Run: `npm install express@^5`

- [ ] **Step 2: Write `src/httpServer.ts`**

```ts
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
```

- [ ] **Step 3: Add npm scripts to `package.json`**

In `package.json`, the `"scripts"` block currently reads:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
```

Replace it with:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "start:http": "node dist/httpServer.js",
    "dev:http": "tsx src/httpServer.ts",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
```

- [ ] **Step 4: Add `MCP_ACCESS_TOKEN` to `.env.example`**

Append to `.env.example`:

```
# Token requis pour le serveur HTTP (claude.ai connector). Générer avec :
#   openssl rand -hex 32
# Ne jamais commiter la vraie valeur (voir .env, ignoré par git).
MCP_ACCESS_TOKEN=remplace_moi_par_un_token_genere
```

- [ ] **Step 5: Build and smoke-test locally**

Generate a local test token and add both required vars to `.env` (do not commit `.env` — it's already gitignored):

```bash
echo "MCP_ACCESS_TOKEN=$(openssl rand -hex 32)" >> .env
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Verify unauthorized request is rejected**

In one terminal: `npm run dev:http`
Expected output includes: `Serveur MCP HTTP pour Moodle démarré sur le port 3000`

In another terminal:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: HTTP 401, JSON body with `"code": -32001`.

- [ ] **Step 7: Verify authorized request lists tools**

With the same `dev:http` server running, read the token from `.env`:

```bash
TOKEN=$(grep MCP_ACCESS_TOKEN .env | cut -d= -f2)
curl -s -X POST "http://localhost:3000/mcp?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: HTTP 200, response containing `"moodle_get_courses"` among the tool names.

- [ ] **Step 8: Verify `GET` and `DELETE` return 405**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/mcp
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3000/mcp
```

Expected: both print `405`.

- [ ] **Step 9: Stop the dev server, commit**

Stop the `npm run dev:http` process (Ctrl+C in its terminal).

```bash
git add src/httpServer.ts package.json package-lock.json .env.example
git commit -m "$(cat <<'EOF'
Add Streamable HTTP transport with token-protected /mcp endpoint

Lets the Moodle MCP server run as a remote HTTP connector (e.g. for
claude.ai custom connectors) alongside the existing stdio mode. Auth
is a static token compared with crypto.timingSafeEqual, passed as a
?token= query parameter since the connector form has no custom-header
field.
EOF
)"
```

---

## Post-plan (not part of this implementation)

Deploying `dist/httpServer.js` on a VPS (process manager, reverse proxy, TLS, firewall) and wiring the resulting HTTPS URL + token into the claude.ai "Ajouter un connecteur personnalisé" form is a separate, infrastructure-specific follow-up.
