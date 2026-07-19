# Moodle MCP Server

Serveur [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) qui expose des données Moodle (cours, utilisateurs, inscriptions, notes, SCORM, rapports de complétion) sous forme d'outils utilisables par Claude.

Deux modes de transport sont disponibles :

- **stdio** — pour un usage local avec Claude Code ou Claude Desktop.
- **HTTP (Streamable HTTP)** — pour déployer le serveur et l'ajouter comme connecteur personnalisé distant sur claude.ai.

## Prérequis

- Node.js 20+
- Une instance Moodle avec le service web REST activé et un token utilisateur (`MOODLE_TOKEN`)

## Installation

```bash
npm install
cp .env.example .env
```

Renseigne ensuite `.env` :

| Variable | Obligatoire | Description |
|---|---|---|
| `MOODLE_URL` | Oui | URL du endpoint REST Moodle, ex: `https://moodle.tonsite.fr/webservice/rest/server.php` |
| `MOODLE_TOKEN` | Oui | Token du web service Moodle |
| `PORT` | Non (mode HTTP uniquement) | Port d'écoute du serveur HTTP (défaut `3000`) |
| `MCP_ACCESS_TOKEN` | Oui (mode HTTP uniquement) | Token d'accès au serveur HTTP — génère-le avec `openssl rand -hex 32` |

## Mode stdio (Claude Code / Claude Desktop)

```bash
npm run dev      # développement (tsx)
npm run build && npm run start   # production
```

Dans la config MCP de Claude Code/Desktop, pointe simplement vers `node dist/index.js` (après `npm run build`) avec les variables d'environnement `MOODLE_URL`/`MOODLE_TOKEN` chargées via `.env`.

## Mode HTTP (connecteur distant claude.ai)

```bash
npm run dev:http      # développement (tsx)
npm run build && npm run start:http   # production
```

Le serveur écoute sur `POST /mcp` (port `PORT`, défaut `3000`). Chaque requête doit inclure le token d'accès en paramètre de requête :

```
https://ton-domaine.com/mcp?token=<MCP_ACCESS_TOKEN>
```

C'est cette URL qu'il faut renseigner dans le champ **URL du serveur MCP distant** du formulaire "Ajouter un connecteur personnalisé" de claude.ai.

Sans `MCP_ACCESS_TOKEN` défini, le serveur refuse de démarrer (aucun mode non protégé possible). Une requête sans token, ou avec un token invalide, reçoit une réponse `401`. `GET`/`DELETE /mcp` renvoient `405` (pas de sessions, le transport est sans état).

### ⚠️ Sécurité : token dans l'URL

Le formulaire de connecteur claude.ai ne permet pas d'envoyer un en-tête HTTP personnalisé, seulement une URL — le token est donc transmis en paramètre de requête plutôt qu'en en-tête `Authorization`. **Tout proxy inverse, CDN, load balancer ou autre infrastructure placée devant ce serveur et qui journalise les URLs complètes des requêtes capturera ce token dans ses logs.** Avant un déploiement public :

- désactive la journalisation des query strings sur tes proxies, ou redacte-les ;
- traite `MCP_ACCESS_TOKEN` comme un secret critique, au même titre que `MOODLE_TOKEN`.

Le déploiement effectif (Docker, systemd, reverse proxy, certificat TLS) n'est pas couvert par ce dépôt — c'est une étape à part, propre à ton infrastructure.

## Outils MCP disponibles

| Outil | Description |
|---|---|
| `moodle_get_courses` | Liste les cours disponibles sur Moodle |
| `moodle_get_users` | Récupère une liste d'utilisateurs Moodle |
| `moodle_get_enrolled_users` | Liste les utilisateurs inscrits dans un cours |
| `moodle_get_grade_items` | Récupère les notes d'un utilisateur dans un cours |
| `moodle_get_scorms_by_courses` | Liste les modules SCORM disponibles dans un ou plusieurs cours |
| `moodle_get_scorm_completion_report` | Génère un rapport de complétion pour un module SCORM |
| `moodle_get_completion_report` | Génère un rapport de complétion pour un cours |

## Architecture

- `src/moodleClient.ts` — client HTTP vers l'API REST Moodle (avec cache).
- `src/tools/*.ts` — définition des outils MCP (schéma Zod + handler).
- `src/server.ts` — construction du serveur MCP (liste des outils, handlers `tools/list`/`tools/call`), partagée par les deux transports.
- `src/index.ts` — point d'entrée stdio.
- `src/httpServer.ts` — point d'entrée HTTP (Express, transport sans état, authentification par token).
