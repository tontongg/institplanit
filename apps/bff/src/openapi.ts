type Operation = { summary: string };

function documentPaths(paths: Record<string, Record<string, Operation>>) {
  return Object.fromEntries(Object.entries(paths).map(([path, operations]) => {
    const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
    return [path, Object.fromEntries(Object.entries(operations).map(([method, operation]) => [method, {
      ...operation,
      ...(parameters.length ? { parameters } : {}),
      responses: {
        '200': { description: 'Opération réussie.' },
        '201': { description: 'Ressource créée.' },
        '204': { description: 'Opération réussie sans contenu.' },
        '400': { description: 'Requête invalide.' },
        '401': { description: 'Authentification requise.' },
        '403': { description: 'Accès interdit.' },
        '404': { description: 'Ressource introuvable.' },
        '409': { description: 'Conflit métier ou de concurrence.' },
        '422': { description: 'Validation métier échouée.' },
      },
    }]))];
  }));
}

export const bffOpenApi = {
  openapi: '3.1.0',
  info: { title: 'InstitPlanit BFF', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: documentPaths({
    '/health/live': { get: { summary: 'Sonde de vie' } },
    '/health/ready': { get: { summary: 'Sonde de disponibilité des services' } },
    '/api/v1/auth/register': { post: { summary: 'Créer un compte et ouvrir une session HttpOnly' } },
    '/api/v1/auth/login': { post: { summary: 'Ouvrir une session HttpOnly' } },
    '/api/v1/auth/logout': { post: { summary: 'Fermer la session' } },
    '/api/v1/me': { get: { summary: 'Profil de la session' } },
    '/api/v1/classrooms': {
      get: { summary: 'Lister ses classes' },
      post: { summary: 'Créer une classe multiniveau' },
    },
    '/api/v1/classrooms/{id}/subjects': { get: { summary: 'Lister les matières' } },
    '/api/v1/classrooms/{id}/sequences': {
      get: { summary: 'Consulter la programmation' },
      post: { summary: 'Créer une séquence' },
    },
    '/api/v1/sequences/{id}': {
      patch: { summary: 'Modifier une séquence' },
      delete: { summary: 'Archiver une séquence' },
    },
    '/api/v1/sequences/{id}/lessons': { post: { summary: 'Ajouter une séance' } },
    '/api/v1/lessons/{id}': {
      patch: { summary: 'Modifier une séance' },
      delete: { summary: 'Archiver une séance' },
    },
    '/api/v1/lessons/{id}/history': { get: { summary: 'Consulter les événements de séance' } },
    '/api/v1/classrooms/{id}/available-lessons': { get: { summary: 'Catalogue de séances à planifier' } },
    '/api/v1/classrooms/{id}/weeks/{weekStart}': {
      get: { summary: 'Lire une semaine' },
      put: { summary: 'Enregistrer la sélection manuelle de séances' },
    },
    '/api/v1/classrooms/{id}/weeks/{weekStart}/confirm': { post: { summary: 'Confirmer le planning' } },
    '/api/v1/classrooms/{id}/weeks/{weekStart}/review': { post: { summary: 'Valider le bilan' } },
    '/api/v1/classrooms/{id}/weeks/{weekStart}/reopen': { post: { summary: 'Réouvrir une semaine' } },
    '/api/v1/classrooms/{id}/progress': { get: { summary: 'Consulter les progressions' } },
    '/api/v1/classrooms/{id}/calendar': { get: { summary: 'Consulter le calendrier' } },
    '/api/v1/classrooms/{id}/calendar/exceptions': { post: { summary: 'Ajouter une exception locale' } },
    '/api/v1/classrooms/{id}/calendar/exceptions/{date}': { delete: { summary: 'Supprimer une exception locale' } },
  }),
} as const;