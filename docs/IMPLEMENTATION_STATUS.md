# État d’implémentation

Mis à jour le 5 novembre 2026.

## Réalisé

- Monorepo pnpm et structure des quatre services ; Docker Compose, probes de santé, configuration TypeScript stricte, ESLint, Prettier et workflow CI.
- Modèle Prisma relationnel initial, migration PostgreSQL versionnée et index partiel empêchant deux affectations actives pour une séance.
- Inscription/connexion avec Argon2id, cookie BFF HttpOnly signé, limitation des tentatives, contrôle d’origine des mutations et identité interne HMAC.
- Création persistée d’une classe multiniveau avec matières par défaut, d’une séquence commune et de séances ciblées dans cette séquence ; édition et archivage logique des séquences/séances.
- Sélection manuelle et brouillon de semaine, confirmation, contrôle atomique de version, prévention en base des doubles affectations, bilans communs/par niveau, report, réouverture et événements d’audit.
- Calcul de progression distinct par niveau, jours fériés nationaux, exceptions locales, interface calendrier, filtres du catalogue et tests des règles pures.
- Interface responsive en français pour authentification, classe, programmation, planning, bilan, progression et calendrier ; seed local CE2/CM1 non-production.
- Saisie des durées restantes et notes au bilan, détail par niveau, préremplissage des corrections et consultation de l’historique d’une séance.
- Parcours Playwright d’acceptation écrit pour inscription → classe → séquence commune → séance → brouillon.
- README et documentation d’architecture, domaine, API et limites.

## À faire

- Édition des paramètres de classe et gestion personnalisée des matières ; réordonnancement des séquences/séances et édition d’objectifs par niveau.
- Adaptateur vérifié vers une source officielle de vacances scolaires, mapping académie/zone et calcul fiable des périodes P1–P5.
- Progression attendue/retard selon les périodes ; alertes du tableau de bord.
- Tests d’intégration PostgreSQL, exécution Playwright en CI, test de persistance après redémarrage, politique RGPD et suppression/export de compte.
- Révocation centralisée des sessions, schémas OpenAPI détaillés (les routes et réponses sont listées), audit de sécurité complet et validation réelle des migrations.

## Limites de validation

- Les dépendances npm n’étaient pas présentes localement et le registre npm était inaccessible pendant l’implémentation ; tests Vitest, lint, typecheck, build et Playwright n’ont donc pas pu être lancés ici. Les assertions Node directes pour calendrier/progression/OpenAPI ont réussi.
- Le daemon Docker n’était pas démarré ; les conteneurs et migrations PostgreSQL n’ont pas pu être exécutés. `docker compose config --quiet` a validé la syntaxe Compose.
- Le calendrier affiche les jours fériés nationaux et les exceptions manuelles, mais n’invente ni vacances ni zone scolaire. Aucune source officielle n’est configurée.
- Le MVP n’est pas encore complet au regard de tous les critères du cahier des charges ; cette liste reflète les parcours non achevés.