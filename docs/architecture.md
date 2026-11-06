# Architecture

InstitPlanit est un monorepo pnpm composé du frontend React/Vite, d’un BFF Fastify, d’un backend métier Fastify et de PostgreSQL. Le frontend ne contacte que le BFF. Le BFF détient le cookie HttpOnly signé et transmet au backend une identité HMAC horodatée. Le backend valide cette identité, puis vérifie la propriété de la classe pour chaque lecture et écriture. PostgreSQL n’est accessible qu’au backend.

Les contrats Zod partagés sont dans `packages/api-contracts`. Le backend porte les règles métier et Prisma. Le BFF ne contient pas de logique pédagogique. La session du MVP est un cookie signé côté client avec expiration de sept jours ; la déconnexion efface le cookie. Une révocation centralisée d’une session déjà copiée n’est pas encore fournie.

Les migrations versionnées sont dans `apps/backend/prisma/migrations`. Le Compose expose le frontend sur `5173`, le BFF sur `3000` et PostgreSQL sur `5432`; le backend reste interne au réseau Compose. La commande backend applique les migrations avant de démarrer. Les probes live et ready sont disponibles sur les deux services HTTP.

Les schémas OpenAPI sont disponibles aux URL `/openapi.json` du BFF et du backend. Le backend métier ne doit pas être publié directement sur Internet en production ; placer le frontend et le BFF derrière HTTPS, limiter le réseau backend et fournir deux secrets distincts d’au moins 32 caractères.