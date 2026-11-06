# Spécifications de réalisation — Application de planification pédagogique

> Document d'implémentation destiné à Codex dans Visual Studio Code. Version 1.0 — 5 novembre 2026.

## 0. Mission de Codex

Construire une application web complète, fonctionnelle et testée de planification pédagogique pour professeur des écoles, prioritairement en classe multiniveau (CP à CM2). Produire le code source, les migrations, les tests, la documentation et l'environnement Docker Compose. Ne pas s'arrêter à des maquettes ou à des routes factices. Implémenter verticalement les parcours MVP, avec données persistantes.

**Principes non négociables :** mutualisation par défaut des séquences et séances entre niveaux ; différenciation facultative à la demande ; sélection **manuelle** des séances de la semaine ; saisie **manuelle** de la programmation annuelle ; conservation de l'historique ; pas de duplication des séances reportées ; aucune donnée nominative d'élève dans le MVP.

### Instructions d'exécution

1. Inspecter le dépôt existant avant toute modification ; ne pas écraser de travail utilisateur.
2. Créer un monorepo structuré tel que décrit ci-dessous, si le dépôt est vide.
3. Implémenter par lots cohérents, chacun exécutable et testé : socle, programmation, planning, bilan, tableau de bord.
4. Tenir à jour `README.md`, `.env.example` et `docs/IMPLEMENTATION_STATUS.md` (réalisé, à faire, limites).
5. Exécuter tests, lint, vérification TypeScript et build ; corriger les erreurs.
6. Ne jamais simuler la persistance en mémoire dans le chemin de production.
7. En cas d'ambiguïté non bloquante, choisir l'option la plus simple, la documenter et continuer ; demander une décision seulement si elle change profondément le métier.

## 1. Périmètre du MVP

### Inclus

- Compte enseignant et authentification sécurisée.
- Création d'une année scolaire et d'une classe multiniveau.
- Paramétrage des niveaux, matières, jours de classe, académie/zone et exceptions calendaires.
- Programmation annuelle manuelle : matières, séquences, séances ordonnées, période cible, objectifs facultatifs par niveau.
- Séquences et séances communes à plusieurs niveaux, sans duplication.
- Séances ciblées sur un niveau lorsque nécessaire.
- Planning hebdomadaire sous forme de liste de séances, sans horaires ni affectation obligatoire aux jours.
- Sélection manuelle des séances, brouillon, validation et édition d'une semaine.
- Bilan de semaine : terminée, partielle, non commencée, annulée ; report manuel.
- Séances complémentaires d'approfondissement pour un niveau.
- Progression annuelle et par matière/niveau ; alertes non bloquantes de retard.
- Historique des reports et modifications ; correction des bilans.
- Calendrier scolaire métropolitain par académie/zone, avec exceptions et prise en compte des jours fériés.
- Interface responsive ordinateur/tablette et utilisable sur mobile.

### Exclus du MVP

- Génération IA, planification automatique, recommandation automatique des séances, import PDF/Excel, partage multi-enseignants, données individuelles d'élèves, notes et évaluations nominatives, emploi du temps horaire, notifications, export PDF, intégration ENT.

## 2. Architecture cible

Architecture de services indépendants déployables séparément :

```text
Navigateur
   |
   v
Frontend (React + TypeScript + Vite)
   | HTTP(S), cookie de session sécurisé
   v
BFF (Node.js + TypeScript + Fastify)
   | HTTP interne, identité utilisateur transmise de façon fiable
   v
Backend métier (Node.js + TypeScript + Fastify)
   | Prisma ORM
   v
PostgreSQL

Backend métier --> fournisseur officiel de calendrier scolaire (adaptateur + cache)
```

Le frontend ne contacte **jamais** directement le backend métier ni PostgreSQL. Le BFF orchestre les besoins de l'interface, gère la session et transforme les réponses ; il n'implémente pas les règles métier. Le backend métier est l'autorité sur la cohérence, les permissions et les transitions de statut. PostgreSQL n'est accessible que par le backend métier. Pas de base propre au BFF pour ce MVP : la session peut être signée/chiffrée et stockée en cookie HttpOnly, avec mécanisme de révocation adapté.

### Stack imposée

- Frontend : React, TypeScript strict, Vite, React Router, TanStack Query, React Hook Form, Zod, bibliothèque de composants accessible (par exemple shadcn/ui + Tailwind CSS).
- BFF : Node.js LTS, TypeScript strict, Fastify, validation Zod, documentation OpenAPI.
- Backend : Node.js LTS, TypeScript strict, Fastify, Prisma, PostgreSQL.
- Tests : Vitest pour unités/intégration, Playwright pour parcours de bout en bout, base PostgreSQL de test isolée.
- Monorepo : pnpm workspaces ; packages partagés pour contrats d'API et types, sans importer les modules métier backend dans le frontend.
- Infrastructure locale : Docker Compose, conteneurs `frontend`, `bff`, `backend`, `postgres` ; healthchecks, volumes persistants, migrations explicites.
- Qualité : ESLint, Prettier, TypeScript strict, CI GitHub Actions.

### Arborescence attendue

```text
apps/
  frontend/
  bff/
  backend/
packages/
  api-contracts/
  shared-config/
prisma/                 # ou apps/backend/prisma/
infra/
  docker/
docs/
  architecture.md
  domain-model.md
  api.md
  IMPLEMENTATION_STATUS.md
compose.yaml
.env.example
README.md
pnpm-workspace.yaml
```

## 3. Concepts métier

### 3.1 Classe et année scolaire

- Un `User` possède ses `Classroom` ; une classe est associée à une `SchoolYear`.
- Une classe possède de 1 à 5 niveaux parmi `CP`, `CE1`, `CE2`, `CM1`, `CM2`.
- Elle possède des jours habituels de classe, une académie, une zone calculée/validée, et des exceptions de calendrier.
- Les semaines et périodes scolaires sont calculées à partir du calendrier, non codées en dur.
- Une classe peut être archivée ; conserver les années précédentes.

### 3.2 Matières, séquences, séances

- `Subject` : matière configurable, éventuellement avec sous-domaines.
- `Sequence` : unité pédagogique **unique** avec titre, matière, niveaux cibles (plusieurs possibles), période cible P1–P5, objectifs, ordre et statut dérivé.
- `Lesson` : séance unique rattachée à une séquence, titre, durée prévue en minutes, ordre, description facultative, niveaux cibles inclus dans ceux de la séquence.
- `LevelObjective` : objectif/approfondissement facultatif par niveau, rattaché à une séquence ou une séance.
- Une séquence commune CE2/CM1 n'est **pas** deux séquences synchronisées : c'est un seul enregistrement avec deux niveaux associés.
- Une séance commune n'est planifiée qu'une fois ; sa durée compte une fois dans la charge de travail.
- Une séance ciblée CM1 peut compléter une séquence commune CE2/CM1.
- Les séances peuvent être réordonnées ; les séances réalisées gardent leur historique.

### 3.3 Semaine et réalisation

- `WeeklyPlan` : classe + semaine ISO (date de début lundi), état `DRAFT` ou `CONFIRMED`.
- `LessonSchedule` : association d'une séance à une semaine, avec statut de planification et horodatages. Historiser les affectations successives.
- `LessonProgress` : avancement d'une séance pour un niveau ciblé, `NOT_STARTED`, `PARTIAL`, `DONE`, `CANCELLED`, avec durée réalisée facultative et note.
- `LessonEvent` : événement immuable d'audit (`SCHEDULED`, `STATUS_CHANGED`, `POSTPONED`, `REOPENED`, `CANCELLED`, etc.) avec acteur, date et détails.
- Une séance commune est validée en une action **pour tous ses niveaux par défaut**, mais le bilan peut être affiné par niveau.
- La fin de séance commune n'implique pas la maîtrise des compétences ; les objectifs de niveau restent distincts.

### 3.4 États et règles

- `NOT_PLANNED` : séance de la programmation non affectée.
- `PLANNED` : affectée à une semaine.
- `PARTIAL` : commencée mais inachevée ; la durée restante peut être renseignée.
- `DONE` : terminée ; n'est plus proposée dans le catalogue des séances à planifier.
- `POSTPONED` : une affectation passée est clôturée ; la séance reste éligible à une nouvelle affectation manuelle.
- `CANCELLED` : annulée explicitement ; ne compte pas comme réalisée ; motif/choix de reprise facultatif.

**Ne pas confondre le statut de la séance, son avancement par niveau et l'état de son affectation hebdomadaire.** Les états affichés peuvent être dérivés de ces données.

## 4. Règles métier impératives

**RM-01 — Mutualisation.** Une séquence peut cibler plusieurs niveaux ; un seul identifiant, une seule liste de séances communes.

**RM-02 — Synchronisation.** Une séance commune sélectionnée pour une semaine est planifiée une seule fois pour l'ensemble des niveaux ciblés ; pas de duplication technique ni visuelle.

**RM-03 — Différenciation facultative.** Chaque niveau peut avoir un objectif, une note ou un approfondissement spécifique ; ne pas imposer cette saisie.

**RM-04 — Validation commune.** Le bilan d'une séance commune peut mettre tous les niveaux à `DONE` en une action ; permettre ensuite de corriger le statut d'un niveau individuellement.

**RM-05 — Approfondissement.** Créer une séance complémentaire ne ciblant qu'un niveau au sein de la séquence commune ; elle ne doit pas faire régresser les autres niveaux.

**RM-06 — Charge non dupliquée.** Les durées des séances communes ne sont comptées qu'une fois dans le total de la semaine ; dans les vues pédagogiques par niveau, leur avancement est visible pour chaque niveau concerné.

**RM-07 — Planification manuelle.** L'application ne sélectionne ni n'ajoute jamais automatiquement une nouvelle séance. Les séances reportables sont affichées pour choix explicite.

**RM-08 — Report sans duplication.** Une séance non terminée peut être retirée de la semaine passée et replanifiée dans une nouvelle semaine ; même `lessonId`, nouvelles traces d'affectation. Une séance ne peut avoir qu'une affectation future active à la fois.

**RM-09 — Ordre souple.** Présenter les séances dans l'ordre de la séquence, mais permettre de planifier une séance ultérieure, avec avertissement non bloquant.

**RM-10 — Historique.** Toute transition significative conserve un événement daté ; les corrections sont historisées et recalculent les indicateurs.

**RM-11 — Suppression.** Interdire la suppression physique silencieuse d'une séquence/séance avec historique ; archiver logiquement, avec confirmation.

**RM-12 — Calendrier.** Interdire par défaut la planification dans une semaine sans jour de classe, sauf dérogation explicite ; afficher les semaines raccourcies.

**RM-13 — Autorisations.** Un utilisateur ne peut accéder ni modifier les données d'un autre utilisateur ; contrôler côté backend chaque lecture et écriture, y compris par identifiant direct.

**RM-14 — Atomicité.** Les validations de bilan, modifications de progression et écritures d'historique sont transactionnelles.

**RM-15 — Cohérence des niveaux.** Un niveau associé à une séance doit appartenir à sa séquence et à la classe. Une séance terminée pour CE2 mais partielle pour CM1 reste globalement inachevée.

## 5. Parcours utilisateurs détaillés

### P01 — Première utilisation

1. Créer un compte / se connecter.
2. Choisir l'année scolaire.
3. Sélectionner l'académie (zone déduite et affichée), les niveaux, les jours habituels de classe.
4. Activer les matières : français, mathématiques, anglais, histoire-géographie, sciences, EPS, arts, EMC ; pouvoir en ajouter ou désactiver.
5. Afficher le calendrier scolaire et ses cinq périodes ; permettre des exceptions.
6. Ouvrir le tableau de bord vide, avec appel à créer une séquence.

**Acceptation :** une classe CE2/CM1 est créée ; les vacances et jours sans classe sont visibles ; les semaines scolaires sont identifiées.

### P02 — Construire la programmation annuelle

1. Choisir une matière.
2. Créer une séquence commune CE2/CM1, avec titre, période cible, objectif général.
3. Ajouter des séances ordonnées (titre, durée, notes facultatives).
4. Facultativement renseigner des attentes CE2 et CM1 distinctes.
5. Réorganiser séquences et séances ; modifier la période cible.
6. Consulter la programmation par matière, période et niveau sans dupliquer les séances communes.

**Acceptation :** une séquence commune apparaît dans les vues CE2 et CM1, mais n'existe qu'une fois en base.

### P03 — Préparer une semaine manuellement

1. Ouvrir une semaine scolaire et voir son état brouillon/validé.
2. Voir les séances encore disponibles et les séances à reprendre, regroupées par matière et filtrables par niveau, période et séquence.
3. Sélectionner explicitement des séances ; aucune présélection automatique.
4. Voir la liste retenue, le nombre de séances et la durée totale sans double comptage.
5. Enregistrer le brouillon ou confirmer.
6. Pouvoir réouvrir et modifier la semaine.

**Acceptation :** la séance CE2/CM1 apparaît une seule fois et ne peut pas être ajoutée deux fois à la même semaine.

### P04 — Bilan du dimanche

1. Ouvrir la semaine précédente.
2. Pour chaque séance, sélectionner `Terminée`, `Partielle`, `Non commencée`, `Annulée`.
3. Pour une séance commune, appliquer par défaut le statut aux niveaux ciblés, avec option « détailler par niveau ».
4. Pour une séance partielle, saisir éventuellement durée restante et note.
5. Valider le bilan ; les séances inachevées deviennent disponibles dans « À replanifier ».
6. Ouvrir la nouvelle semaine et sélectionner manuellement les séances à reprendre et les nouvelles séances.
7. Enregistrer et consulter le tableau de bord recalculé.

**Acceptation :** une séance partielle n'est pas dupliquée ; son historique indique la semaine précédente et la nouvelle semaine lorsqu'elle est replanifiée.

### P05 — Différencier sans désynchroniser

1. Planifier et réaliser une séance commune CE2/CM1.
2. Marquer CE2 `DONE` et CM1 `PARTIAL`, ou terminer la séance commune puis constater un besoin d'approfondissement CM1.
3. Dans le premier cas, conserver la séance à reprendre pour CM1 seulement ; dans le second, créer une séance complémentaire CM1 rattachée à la même séquence.
4. Conserver une seule séquence annuelle et des indicateurs distincts par niveau.

**Acceptation :** le bilan CE2 ne régresse pas quand CM1 poursuit le travail.

### P06 — Corriger et consulter l'historique

1. Réouvrir une semaine antérieure.
2. Corriger le statut d'une séance.
3. Recalculer les progressions et conserver l'événement de correction.
4. Si une correction contredit une affectation ultérieure, afficher un conflit à résoudre, sans effacer silencieusement les données.

## 6. Écrans et ergonomie

1. **Connexion / création de compte**.
2. **Configuration de la classe** : année, académie, niveaux, jours, matières.
3. **Tableau de bord** : semaine actuelle, séances en attente, progression annuelle, alertes.
4. **Programmation annuelle** : regroupement matière > séquence > séances, filtres par niveau et période, actions d'édition.
5. **Éditeur de séquence** : niveaux communs, séances ordonnées, différenciation facultative.
6. **Planning hebdomadaire** : catalogue de séances à gauche, sélection de la semaine à droite (adaptation responsive), sans grille horaire.
7. **Bilan hebdomadaire** : liste compacte, statut par séance, détail par niveau à la demande.
8. **Calendrier et paramètres** : vacances, jours de classe, exceptions.
9. **Historique** : événements d'une séance, reports et corrections.

### UX prioritaire

- Objectif produit : préparer la semaine en 5 à 10 minutes une fois le programme annuel renseigné.
- Préférer des actions rapides en liste, filtres conservés pendant la session et édition sans navigation excessive.
- Indiquer visuellement « commune CE2 + CM1 » et « spécifique CM1 ».
- Confirmation avant actions destructrices ; messages d'erreur compréhensibles ; états vides utiles.
- Les actions de démonstration doivent être de vraies opérations persistées, non de simples boutons inertes.
- Langue de l'interface : français ; dates et fuseau `Europe/Paris` ; stocker les timestamps en UTC.

## 7. Modèle de données relationnel indicatif

Codex doit proposer et implémenter un schéma Prisma normalisé, avec clés étrangères, index, contraintes d'unicité et suppressions maîtrisées. Entités minimales :

| Entité | Champs / relations principaux |
|---|---|
| `User` | id, email unique, passwordHash, createdAt |
| `SchoolYear` | id, label, startDate, endDate |
| `Classroom` | id, ownerId, schoolYearId, name, academyCode, zoneCode, archivedAt |
| `ClassroomLevel` | classroomId, level (unique par paire) |
| `ClassroomDay` | classroomId, weekday |
| `Subject` | id, classroomId, name, sortOrder, active |
| `Sequence` | id, classroomId, subjectId, title, description, targetPeriod, sortOrder, archivedAt |
| `SequenceLevel` | sequenceId, level, optionalObjective |
| `Lesson` | id, sequenceId, title, description, estimatedMinutes, sortOrder, archivedAt |
| `LessonLevel` | lessonId, level, optionalObjective, optionalNotes |
| `WeeklyPlan` | id, classroomId, weekStartDate, state, confirmedAt, unique(classroomId,weekStartDate) |
| `LessonSchedule` | id, weeklyPlanId, lessonId, state, scheduledAt, closedAt, remainingMinutes, unique active scheduling invariant |
| `LessonProgress` | lessonId, level, state, completedMinutes, notes, updatedAt, unique(lessonId,level) |
| `LessonEvent` | id, lessonId, scheduleId nullable, actorId, eventType, payload JSON, createdAt |
| `CalendarException` | id, classroomId, date, isTeachingDay, reason |
| `SchoolCalendarCache` | academyCode, schoolYear, source, fetchedAt, payload/normalized events |

**Important :** le schéma peut être adapté pour mieux représenter la progression partielle et les événements, à condition de respecter les invariants métier. Les événements ne doivent pas devenir la seule source de vérité sans projection fiable et testée.

### Invariants de base de données

- Une séquence appartient à une classe et à une matière de cette même classe.
- Les niveaux d'une séquence appartiennent à la classe ; ceux d'une séance sont inclus dans ceux de sa séquence.
- Une séance a au moins un niveau cible pour être planifiable.
- Une semaine commence un lundi ; unicité par classe et date.
- Un seul `LessonSchedule` actif par `lessonId` ; utiliser un index unique partiel PostgreSQL si nécessaire.
- Une séance `DONE` pour tous ses niveaux ne peut être planifiée à nouveau sans réouverture explicite.
- Les modifications de planning et de progression doivent être transactionnelles et résistantes aux doubles clics.

## 8. API métier et BFF

Définir des routes versionnées `/api/v1`. Les routes ci-dessous constituent le contrat fonctionnel minimal, à compléter dans OpenAPI.

| Méthode | Route | Finalité |
|---|---|---|
| POST | `/auth/register` | Créer un compte |
| POST | `/auth/login` | Ouvrir une session |
| POST | `/auth/logout` | Fermer une session |
| GET | `/me` | Profil connecté |
| GET/POST | `/classrooms` | Lister / créer des classes |
| GET/PATCH | `/classrooms/:id` | Consulter / modifier une classe |
| GET/POST | `/classrooms/:id/subjects` | Matières |
| GET/POST | `/classrooms/:id/sequences` | Programmation annuelle |
| GET/PATCH/DELETE | `/sequences/:id` | Séquence (DELETE = archivage contrôlé) |
| GET/POST | `/sequences/:id/lessons` | Séances d'une séquence |
| PATCH/DELETE | `/lessons/:id` | Modifier / archiver une séance |
| GET | `/classrooms/:id/available-lessons` | Catalogue des séances planifiables, filtres |
| GET/PUT | `/classrooms/:id/weeks/:weekStart` | Consulter / créer ou éditer une semaine |
| POST | `/classrooms/:id/weeks/:weekStart/confirm` | Confirmer le planning |
| POST | `/classrooms/:id/weeks/:weekStart/review` | Valider le bilan transactionnel |
| GET | `/lessons/:id/history` | Historique des événements |
| GET | `/classrooms/:id/progress` | Progression agrégée par matière/niveau/période |
| GET | `/classrooms/:id/calendar` | Calendrier et semaines scolaires |
| POST/DELETE | `/classrooms/:id/calendar/exceptions` | Exceptions de jours de classe |

Les routes publiques du BFF peuvent exposer les mêmes intentions, avec agrégation adaptée à l'UI. Le backend métier ne doit pas accepter aveuglément un `userId` envoyé par le navigateur. Authentifier les appels interservices, établir l'identité dans le BFF, la transmettre via un mécanisme signé ou une identité de service vérifiable et **revérifier les droits métier** côté backend.

### Contrats et erreurs

- Zod pour validation des entrées ; OpenAPI pour documentation.
- Codes HTTP cohérents : 400/422 validation, 401 non authentifié, 403 interdit, 404 introuvable, 409 conflit métier, 500 erreur interne.
- Réponses d'erreur structurées avec `code`, `message`, `details` facultatifs et `requestId`.
- Pagination des listes volumineuses, filtres explicites et tri stable.
- Contrôle de concurrence optimiste sur semaines et bilans (version ou `updatedAt`) ; 409 en cas d'édition concurrente.
- Idempotence des actions critiques (confirmation, bilan, report) par clé de requête ou protection équivalente.

## 9. Calendrier scolaire français

- Fournir un adaptateur configurable vers une source officielle (par exemple les jeux de données publiés sur `data.gouv.fr` ou une API officielle compatible).
- **Ne pas inventer d'URL d'API, de dates de vacances ou de zone** : vérifier la source et documenter son contrat ; si elle est inaccessible, afficher une erreur contrôlée et permettre une configuration manuelle.
- Mapper académie vers zone métropolitaine, en traitant les cas particuliers (Corse, outre-mer) séparément ; ne pas prétendre qu'ils suivent toujours A/B/C.
- Calculer les périodes P1–P5 en fonction des vacances ; tenir compte des bornes inclusives/exclusives et du fuseau horaire.
- Utiliser les jours de classe de la classe et les jours fériés applicables pour calculer les jours réellement travaillés.
- Mettre en cache les données avec date de récupération et source ; possibilité de rafraîchir.
- Les exceptions locales priment sur les jours habituels ; ne jamais supprimer les planifications existantes lors d'une mise à jour du calendrier.
- Ajouter des tests pour une semaine de vacances, une semaine avec jour férié, un mercredi non travaillé et une exception locale.

## 10. Calcul de progression

### Définition

- La charge hebdomadaire est la somme des durées estimées des **séances distinctes** sélectionnées.
- La progression par niveau est basée sur les séances ciblant ce niveau et leur avancement individuel.
- La progression d'une séquence commune peut afficher une synthèse et une ventilation par niveau ; ne pas confondre charge de travail et somme des charges par niveau.
- Pour une séance `DONE`, contribution = 100 % de sa durée estimée pour le niveau concerné.
- Pour `NOT_STARTED`, contribution = 0 % ; pour `PARTIAL`, utiliser la durée réalisée bornée entre 0 et la durée estimée.
- Pour `CANCELLED`, ne pas compter comme réalisée et signaler la séance annulée séparément.
- Ne jamais interpréter la fin d'une séance comme une preuve de maîtrise de compétence.

### Avancement attendu et retard

- Calculer une cible indicative selon les périodes cibles et le calendrier scolaire, en explicitant la formule dans `docs/domain-model.md`.
- Afficher réalisé, attendu et écart ; avertissements non bloquants.
- Si les durées sont absentes ou incohérentes, ne pas produire de pourcentage trompeur : afficher « données insuffisantes ».
- Les modifications rétroactives déclenchent un recalcul fiable.

## 11. Sécurité, données et exploitation

- Hachage des mots de passe avec Argon2id ; politique de mots de passe et limitation des tentatives de connexion.
- Cookies `HttpOnly`, `Secure` en production, `SameSite` approprié ; protection CSRF pour mutations basées sur cookie.
- HTTPS en production, CORS restrictif, en-têtes de sécurité, validation stricte des entrées.
- Secrets uniquement dans variables d'environnement / secret manager ; aucun secret commité.
- Isolation multi-tenant par propriétaire de classe, vérifiée côté backend.
- Logs structurés avec `requestId`, sans mots de passe, tokens ni données sensibles.
- Endpoints `/health/live` et `/health/ready` sur BFF et backend ; readiness dépendances.
- Migrations Prisma versionnées ; sauvegarde et restauration PostgreSQL documentées.
- Ne pas collecter de noms, notes ou informations individuelles d'élèves dans le MVP.
- Prévoir suppression/export des données utilisateur et politique de conservation documentée pour conformité RGPD.

## 12. Tests d'acceptation indispensables

Créer des tests unitaires métier, intégration API avec PostgreSQL et E2E Playwright pour les scénarios suivants :

1. Créer une classe CE2/CM1, année scolaire, matières et calendrier.
2. Créer une séquence « Groupe nominal » commune CE2/CM1 et trois séances : une seule séquence en base.
3. Planifier une séance commune : une ligne UI, une affectation, durée comptée une seule fois.
4. Marquer une séance commune terminée : progression CE2 et CM1 mise à jour.
5. Marquer CE2 terminé et CM1 partiel : progression CE2 maintenue, séance à reprendre pour CM1.
6. Ajouter une séance d'approfondissement CM1 à la séquence commune : CE2 non affecté.
7. Laisser une séance non commencée, clôturer la semaine et la sélectionner manuellement la semaine suivante : même `lessonId`, historique complet.
8. Vérifier qu'aucune séance n'est automatiquement ajoutée lors de la création d'une semaine.
9. Empêcher une double affectation active et gérer une tentative concurrente avec conflit 409.
10. Corriger un bilan antérieur : indicateurs recalculés et événement d'audit créé.
11. Empêcher l'accès à une classe appartenant à un autre utilisateur.
12. Vérifier le calendrier : vacances, jour férié, semaine raccourcie, exception.
13. Vérifier l'archivage d'une séquence avec historique sans destruction des événements.
14. Vérifier persistance après redémarrage des conteneurs.

## 13. Critères de livraison

La livraison du MVP doit comprendre :

- Application complète navigable et utilisable, sans écran vide ni bouton fictif.
- `docker compose up --build` permettant de démarrer les services après configuration `.env` ; documentation explicite des migrations et du seed.
- Compte de démonstration créé par seed **uniquement en environnement local/de test**, avec identifiants documentés hors production.
- Données de démonstration : classe CE2/CM1, plusieurs matières, séquences communes, séances différenciées, semaines passées et à préparer.
- README : prérequis, installation, démarrage, tests, variables, ports, architecture, dépannage.
- OpenAPI consultable pour BFF et backend ; exemples de requêtes.
- Tests automatisés verts, lint et build réussis.
- `docs/IMPLEMENTATION_STATUS.md` indiquant honnêtement ce qui est terminé ou non.

## 14. Ordre de travail recommandé pour Codex

### Lot 1 — Infrastructure et identité

Monorepo, configuration TS, Docker Compose, PostgreSQL, Prisma, BFF, backend, frontend, healthchecks, authentification et CI.

### Lot 2 — Classe et programmation

Année scolaire, classe multiniveau, matières, calendrier, séquences communes, séances, objectifs facultatifs par niveau, interfaces CRUD.

### Lot 3 — Planning manuel

Catalogue filtrable, brouillon hebdomadaire, sélection manuelle, validation, interdiction des doublons, total de charge.

### Lot 4 — Bilan et reports

Statuts, bilan commun et par niveau, replanification manuelle, approfondissement, historique et corrections.

### Lot 5 — Pilotage et robustesse

Progressions, retards, exceptions calendaires, tests E2E, ergonomie, documentation, sécurité et stabilisation.

## 15. Première action demandée à Codex

Commencer par :

1. Examiner l'état du dépôt.
2. Présenter un plan d'implémentation court et les choix techniques complémentaires.
3. Créer la structure du monorepo, le Compose, les applications minimales et les healthchecks.
4. Définir le schéma Prisma et les premières migrations.
5. Implémenter un premier parcours vertical réel : connexion → création classe CE2/CM1 → création séquence commune → ajout d'une séance → consultation persistée.
6. Exécuter les tests et documenter les commandes et résultats.
7. Continuer ensuite les lots jusqu'à satisfaire les critères du MVP, sans demander une confirmation à chaque étape non bloquante.

**Priorité absolue :** simplicité d'usage pour l'enseignante et justesse des règles de mutualisation pédagogique. Ne jamais remplacer ces règles par une simple duplication de programmes par niveau.
