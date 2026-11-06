# InstitPlanit

Application web de programmation pédagogique et de préparation hebdomadaire pour classes multiniveaux. Une séquence ou une séance commune reste un enregistrement unique, partagé entre les niveaux concernés. Le choix des séances de semaine reste manuel.

## Démarrage local

Prérequis : Node.js 22+, pnpm 10+, Docker Desktop avec le moteur Linux démarré.

```powershell
corepack enable
Copy-Item .env.example .env
```

Remplacez `SESSION_SECRET` et `INTERNAL_SERVICE_SECRET` dans `.env` par deux secrets différents d’au moins 32 caractères.

```powershell
pnpm install
docker compose up --build -d
docker compose exec backend pnpm db:seed
```

Ouvrir http://localhost:5173. Le BFF est sur le port `3000`, PostgreSQL sur `5432`; le backend métier sur `3001` reste interne à Compose. Le service backend applique les migrations avant son démarrage. Le seed de démonstration est interdit lorsque `NODE_ENV=production`.

Compte local seedé : `demo@institplanit.local` / `ClasseMultiNiveaux-2026!`. Définir `DEMO_PASSWORD` avant le seed pour choisir un autre mot de passe.

## Développement et qualité

```powershell
pnpm dev
pnpm db:generate
pnpm db:migrate
pnpm db:dev
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Pour les commandes Prisma lancées depuis Windows, utilisez `DATABASE_URL` vers `localhost` dans `.env`. Dans Compose, le backend utilise automatiquement le nom DNS `postgres`. Les tests E2E nécessitent les services déjà démarrés. `pnpm dev` lance les trois applications ; PostgreSQL doit déjà être accessible et les migrations appliquées.

## Architecture

```text
Navigateur -> React/Vite -> BFF Fastify -> Backend Fastify -> Prisma -> PostgreSQL
```

Le navigateur n’accède qu’au BFF. Le BFF porte la session cookie HttpOnly signée et transmet l’identité au backend avec une signature HMAC interne. Le backend revérifie les permissions par propriétaire de classe. Le modèle et les responsabilités sont détaillés dans [docs/architecture.md](docs/architecture.md) et [docs/domain-model.md](docs/domain-model.md).

Contrats OpenAPI : `http://localhost:3000/openapi.json` pour le BFF et `http://backend:3001/openapi.json` depuis le réseau Docker. Le contrat et les erreurs sont décrits dans [docs/api.md](docs/api.md).

## Calendrier et limites

Les jours fériés nationaux et les exceptions manuelles sont calculés localement. L’adaptateur vers une source officielle de vacances et le mapping des académies restent à implémenter ; aucune date de vacances n’est inventée et l’API signale cette limite.

L’application contient le socle technique et des parcours persistants de compte, classe, programmation, planning et bilan. Plusieurs fonctions du MVP restent à compléter ; voir [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).
