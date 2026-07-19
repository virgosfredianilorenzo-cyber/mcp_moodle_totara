# Ajout d'un transport HTTP (Streamable HTTP) au serveur MCP Moodle

## Contexte

Le serveur MCP Moodle (`src/index.ts`) ne fonctionne aujourd'hui qu'en transport **stdio**, adapté à un usage local (Claude Code / Claude Desktop via config locale). Le formulaire "Ajouter un connecteur personnalisé" de claude.ai exige une **URL de serveur MCP distant** accessible en HTTP — ce que stdio ne permet pas.

Objectif : ajouter une option de transport HTTP **en plus** du stdio existant (qui reste inchangé), afin de pouvoir déployer ce serveur sur un VPS et l'ajouter comme connecteur personnalisé sur claude.ai.

## Portée

- Ajouter un point d'entrée HTTP alternatif, sans casser le point d'entrée stdio existant.
- Protéger l'accès HTTP par un token statique (le serveur expose des données Moodle sensibles — utilisateurs, notes, complétion).
- Ne couvre PAS : le déploiement effectif sur le VPS (Dockerfile, systemd, reverse proxy, HTTPS/TLS) — hors scope de cette itération, à traiter séparément une fois le code validé.

## Architecture

### Refactor : logique serveur partagée

Extraire de `src/index.ts` la construction du serveur MCP (liste des outils + handlers `ListToolsRequestSchema`/`CallToolRequestSchema`) dans un nouveau module `src/server.ts` :

```ts
export function createMcpServer(moodleClient: MoodleClient): Server
```

- Prend le `MoodleClient` déjà instancié en paramètre (pas de nouvelle instanciation interne).
- Retourne un `Server` MCP configuré avec tous les outils existants (courses, users, enrolments, grades, scorm, reports) et ses handlers, identique au comportement actuel.
- Le logger winston existant est réutilisé tel quel (pas de changement de configuration des logs).

### `src/index.ts` (existant, stdio)

Modifié uniquement pour appeler `createMcpServer(moodleClient)` puis se connecter via `StdioServerTransport`, comme aujourd'hui. Aucun changement de comportement observable.

### `src/httpServer.ts` (nouveau, HTTP)

- Charge `.env`, vérifie `MOODLE_URL`/`MOODLE_TOKEN` (comme `index.ts`), instancie `MoodleClient`.
- Vérifie au démarrage que `MCP_ACCESS_TOKEN` est défini ; si absent, log une erreur et `process.exit(1)` (pas de démarrage en mode non protégé).
- Crée une app Express avec un endpoint `POST /mcp` :
  - Middleware d'auth : compare `req.query.token` à `MCP_ACCESS_TOKEN` (comparaison en temps constant via `crypto.timingSafeEqual`). Si absent ou incorrect → `401` avec un corps JSON-RPC d'erreur cohérent avec le protocole MCP.
  - Si authentifié : crée un `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (mode **stateless** — cohérent avec le fait que les outils Moodle sont sans état, un simple appel = une réponse), connecte un `createMcpServer(moodleClient)` fraîchement créé à ce transport, puis `transport.handleRequest(req, res, req.body)`.
  - Ferme transport + server sur l'event `close` de la réponse (comme l'exemple officiel du SDK).
- `GET /mcp` et `DELETE /mcp` → `405 Method Not Allowed` (pas de sessions à lister/fermer en mode stateless).
- Écoute sur `process.env.PORT` (défaut `3000`).
- Logging : mêmes logs winston que le mode stdio (connexions, appels d'outils, erreurs), plus un log de démarrage indiquant le port.

### Authentification — token dans l'URL

Le formulaire claude.ai ne permet pas de saisir un header HTTP personnalisé, seulement une URL (+ éventuellement OAuth client id/secret, hors scope ici). Le token est donc transmis en query string :

```
https://ton-domaine.com/mcp?token=<MCP_ACCESS_TOKEN>
```

- Générer le token soi-même (ex. `openssl rand -hex 32`) et le stocker dans `MCP_ACCESS_TOKEN` côté serveur (`.env`, jamais commité).
- Compromis assumé : le token peut apparaître dans des logs d'infrastructure intermédiaires (reverse proxy, CDN) qui logueraient les URLs complètes. Acceptable pour un usage personnel sur un VPS que l'utilisateur contrôle ; à documenter dans le README.

## Configuration / scripts

- Nouvelles variables d'env (à ajouter dans `.env.example` s'il existe, sinon documenter dans le README) :
  - `MCP_ACCESS_TOKEN` (obligatoire pour le mode HTTP)
  - `PORT` (optionnel, défaut `3000`)
- Nouveaux scripts npm dans `package.json` :
  - `"dev:http": "tsx src/httpServer.ts"`
  - `"start:http": "node dist/httpServer.js"` (après `npm run build`)
- `express` déplacé des dépendances transitives du SDK vers une dépendance directe du projet (déjà présent dans `node_modules` via `@modelcontextprotocol/sdk`, version compatible `^5.x`).

## Gestion des erreurs

- Token manquant/invalide → `401`, log winston niveau `warn` avec l'IP source (pas le token en clair dans les logs applicatifs).
- `MOODLE_URL`/`MOODLE_TOKEN` manquants → comportement identique à l'existant (arrêt au démarrage).
- Erreur dans un outil (`tool.handler` qui throw) → propagée telle quelle par le SDK au client MCP, comme en mode stdio aujourd'hui (pas de changement de ce comportement).

## Tests / validation

- Test manuel : démarrer `npm run dev:http`, vérifier avec `curl` que :
  - une requête sans `token` (ou avec un mauvais token) reçoit `401`,
  - une requête avec le bon token et un payload JSON-RPC `tools/list` valide reçoit la liste des outils.
- Pas de suite de tests automatisés existante dans le projet (`npm test` est un placeholder) — on ne change pas ça dans le cadre de cette itération.

## Hors scope (prochaines étapes possibles, non traitées ici)

- Dockerfile / déploiement VPS (systemd, reverse proxy, certificat TLS).
- Rotation ou expiration du token.
- Mode OAuth complet si un jour nécessaire pour un usage multi-utilisateur.
