# API

Toutes les routes publiques sont versionnées sous `/api/v1` sur le BFF (`http://localhost:3000`). Le BFF relaie les routes métier et fournit `/auth/register`, `/auth/login`, `/auth/logout` avec cookie HttpOnly. Les requêtes modifiant des données doivent provenir de l’origine frontend configurée. Le navigateur ne reçoit jamais l’identité interne HMAC.

Contrats OpenAPI :

- BFF : `GET /openapi.json`
- Backend métier interne : `GET /openapi.json`

Le backend refuse les appels métier sans signature HMAC valide. Erreurs structurées : `code`, `message`, `requestId`. Les conflits d’affectation, de semaine confirmée et de version utilisent HTTP 409. Les semaines sont adressées par leur lundi ISO (`AAAA-MM-JJ`).

Exemple de création de compte via le BFF :

```http
POST /api/v1/auth/register
Content-Type: application/json

{"email":"enseignant@example.fr","password":"UnePhraseDePasseSolide-2026"}
```

Le BFF établit le cookie de session à la réponse. Les routes de classe, programmation, catalogue, planning, bilan, progression et calendrier réutilisent ce cookie avec `credentials: include`.