import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createHmac } from 'node:crypto';
import { bffOpenApi } from './openapi';

const app = Fastify({ logger: true });
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';
const sessionSecret = process.env.SESSION_SECRET ?? 'local-session-secret-change-this-32-bytes-minimum';
const internalSecret = process.env.INTERNAL_SERVICE_SECRET ?? 'local-internal-secret-change-this';
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
if (process.env.NODE_ENV === 'production' && (
  sessionSecret.length < 32 || internalSecret.length < 32 || sessionSecret === internalSecret
  || sessionSecret === 'local-session-secret-change-this-32-bytes-minimum'
  || internalSecret === 'local-internal-secret-change-this'
  || sessionSecret === 'replace-with-at-least-32-random-bytes'
  || internalSecret === 'replace-with-a-different-random-secret'
  || !frontendOrigin.startsWith('https://')
)) {
  throw new Error('Production requires distinct non-placeholder secrets of at least 32 characters and an HTTPS frontend origin.');
}
await app.register(helmet);
await app.register(cors, {
  origin: frontendOrigin,
  credentials: true,
});
await app.register(cookie, { secret: sessionSecret });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/openapi.json', async () => bffOpenApi);
app.get('/health/ready', async (request, reply) => {
  try {
    const response = await fetch(`${backendUrl}/health/ready`);
    return reply.code(response.ok ? 200 : 503).send({ status: response.ok ? 'ok' : 'unavailable' });
  } catch {
    return reply.code(503).send({ status: 'unavailable' });
  }
});

app.post('/api/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
  if (request.headers.origin !== frontendOrigin) return reply.code(403).send({ code: 'INVALID_ORIGIN', message: 'Origine de requête invalide.', requestId: request.id });
  const response = await fetch(`${backendUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  const payload = await response.json();
  if (!response.ok) return reply.code(response.status).send(payload);
  reply.setCookie('institplanit_session', payload.id, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return reply.code(201).send({ id: payload.id, email: payload.email });
});

app.post('/api/v1/auth/login', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
  if (request.headers.origin !== frontendOrigin) return reply.code(403).send({ code: 'INVALID_ORIGIN', message: 'Origine de requête invalide.', requestId: request.id });
  const response = await fetch(`${backendUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  const payload = await response.json();
  if (!response.ok) return reply.code(response.status).send(payload);
  reply.setCookie('institplanit_session', payload.id, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return payload;
});

app.post('/api/v1/auth/logout', async (_request, reply) => {
  if (_request.headers.origin !== frontendOrigin) return reply.code(403).send({ code: 'INVALID_ORIGIN', message: 'Origine de requête invalide.', requestId: _request.id });
  reply.clearCookie('institplanit_session', { path: '/' });
  return reply.code(204).send();
});

app.route({
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  url: '/api/v1/*',
  handler: async (request, reply) => {
    if (request.method !== 'GET' && request.headers.origin !== frontendOrigin) {
      return reply.code(403).send({ code: 'INVALID_ORIGIN', message: 'Origine de requête invalide.', requestId: request.id });
    }
    const signedCookie = request.cookies.institplanit_session;
    const session = signedCookie ? request.unsignCookie(signedCookie) : null;
    if (!session?.valid || !session.value) {
      return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentification requise.', requestId: request.id });
    }
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', internalSecret).update(`${session.value}:${timestamp}`).digest('hex');
    const contentType = request.headers['content-type'];
    const response = await fetch(`${backendUrl}/api/v1/${(request.params as { '*'?: string })['*'] ?? ''}`, {
      method: request.method,
      headers: {
        ...(contentType ? { 'content-type': contentType } : {}),
        'x-institplanit-user': session.value,
        'x-institplanit-time': timestamp,
        'x-institplanit-signature': signature,
      },
      ...(request.method === 'GET' || request.method === 'DELETE' ? {} : { body: JSON.stringify(request.body) }),
    });
    const text = await response.text();
    if (response.status === 204 || !text) return reply.code(response.status).send();
    const responseType = response.headers.get('content-type');
    if (responseType?.includes('application/json')) {
      return reply.code(response.status).type('application/json').send(JSON.parse(text));
    }
    return reply.code(response.status).send(text);
  },
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });