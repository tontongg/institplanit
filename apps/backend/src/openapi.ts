type Operation = { summary: string; security?: { serviceIdentity: string[] }[] };

function documentPaths(paths: Record<string, Record<string, Operation>>) {
  return Object.fromEntries(Object.entries(paths).map(([path, operations]) => {
    const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
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

export const backendOpenApi = {
  openapi: '3.1.0',
  info: { title: 'InstitPlanit backend métier', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3001' }],
  paths: documentPaths({
    '/health/live': { get: { summary: 'Sonde de vie' } },
    '/health/ready': { get: { summary: 'Sonde de disponibilité PostgreSQL' } },
    '/api/v1/auth/register': { post: { summary: 'Créer un compte enseignant' } },
    '/api/v1/auth/login': { post: { summary: 'Vérifier les identifiants' } },
    '/api/v1/me': { get: { summary: 'Profil utilisateur', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms': {
      get: { summary: 'Lister les classes de l’utilisateur', security: [{ serviceIdentity: [] }] },
      post: { summary: 'Créer une classe multiniveau', security: [{ serviceIdentity: [] }] },
    },
    '/api/v1/classrooms/{id}/subjects': { get: { summary: 'Lister les matières', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/sequences': {
      get: { summary: 'Consulter la programmation annuelle', security: [{ serviceIdentity: [] }] },
      post: { summary: 'Créer une séquence mutualisée', security: [{ serviceIdentity: [] }] },
    },
    '/api/v1/sequences/{id}': {
      patch: { summary: 'Modifier une séquence', security: [{ serviceIdentity: [] }] },
      delete: { summary: 'Archiver une séquence', security: [{ serviceIdentity: [] }] },
    },
    '/api/v1/sequences/{id}/lessons': { post: { summary: 'Ajouter une séance', security: [{ serviceIdentity: [] }] } },
    '/api/v1/lessons/{id}': {
      patch: { summary: 'Modifier une séance', security: [{ serviceIdentity: [] }] },
      delete: { summary: 'Archiver une séance', security: [{ serviceIdentity: [] }] },
    },
    '/api/v1/lessons/{id}/history': { get: { summary: 'Consulter les événements de séance', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/available-lessons': { get: { summary: 'Lister les séances à planifier', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/weeks/{weekStart}': {
      get: { summary: 'Lire une semaine', security: [{ serviceIdentity: [] }] },
      put: { summary: 'Éditer manuellement les séances de la semaine', security: [{ serviceIdentity: [] }] },
    },
    '/api/v1/classrooms/{id}/weeks/{weekStart}/confirm': { post: { summary: 'Confirmer une semaine', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/weeks/{weekStart}/review': { post: { summary: 'Valider le bilan de semaine', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/weeks/{weekStart}/reopen': { post: { summary: 'Réouvrir une semaine et vérifier les conflits ultérieurs', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/progress': { get: { summary: 'Calculer les progressions par matière et niveau', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/calendar': { get: { summary: 'Lire le calendrier scolaire et les exceptions', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/calendar/exceptions': { post: { summary: 'Créer ou modifier une exception locale', security: [{ serviceIdentity: [] }] } },
    '/api/v1/classrooms/{id}/calendar/exceptions/{date}': { delete: { summary: 'Supprimer une exception locale', security: [{ serviceIdentity: [] }] } },
  }),
  components: {
    securitySchemes: {
      serviceIdentity: { type: 'apiKey', in: 'header', name: 'x-institplanit-signature', description: 'Signature HMAC interne avec identité et horodatage.' },
    },
  },
} as const;