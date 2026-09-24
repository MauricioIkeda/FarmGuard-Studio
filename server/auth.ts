import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

type Session = { username: string; expiresAt: number };
type Attempt = { count: number; resetAt: number };

const sessionFile = path.join(config.dataRoot, 'sessions.json');
function readSessions() {
  try {
    const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as Record<string, Session>;
    return new Map(Object.entries(saved).filter(([, session]) =>
      typeof session?.username === 'string' && typeof session.expiresAt === 'number' && session.expiresAt > Date.now(),
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Não foi possível ler as sessões salvas:', error);
    return new Map<string, Session>();
  }
}
const sessions = readSessions();
function saveSessions() {
  fs.mkdirSync(config.dataRoot, { recursive: true });
  const temporary = `${sessionFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  fs.renameSync(temporary, sessionFile);
}
const attempts = new Map<string, Attempt>();
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const attemptWindow = 15 * 60 * 1000;
const maxAttempts = 7;

function parseCookies(header?: string) {
  return Object.fromEntries(
    String(header || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf('=');
        return [
          decodeURIComponent(separator >= 0 ? item.slice(0, separator) : item),
          decodeURIComponent(separator >= 0 ? item.slice(separator + 1) : ''),
        ];
      }),
  );
}

function signature(token: string) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(token)
    .digest('base64url');
}

function sessionId(request: Request) {
  let raw: string | undefined;
  try { raw = parseCookies(request.headers.cookie).farmguard_session; }
  catch { return null; }
  if (!raw) return null;
  const [token, suppliedSignature] = raw.split('.');
  if (!token || !suppliedSignature) return null;
  const expected = signature(token);
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    supplied.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(supplied, expectedBuffer)
  ) return null;
  return token;
}

export function currentSession(request: Request) {
  if (!config.authEnabled) return { username: config.adminUsername, expiresAt: Infinity };
  const id = sessionId(request);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    if (id && sessions.delete(id)) saveSessions();
    return null;
  }
  return session;
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (currentSession(request)) return next();
  response.status(401).json({ error: 'Autenticacao necessaria.' });
}

function safeEqual(left: string, right: string) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

export function login(request: Request, response: Response) {
  const address = request.ip || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = attempts.get(address);
  if (attempt && attempt.resetAt > now && attempt.count >= maxAttempts) {
    return response.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const username = String(request.body?.username || '');
  const password = String(request.body?.password || '');
  if (
    !config.adminPassword ||
    !config.sessionSecret ||
    !safeEqual(username, config.adminUsername) ||
    !safeEqual(password, config.adminPassword)
  ) {
    const active = attempt && attempt.resetAt > now
      ? { count: attempt.count + 1, resetAt: attempt.resetAt }
      : { count: 1, resetAt: now + attemptWindow };
    attempts.set(address, active);
    return response.status(401).json({ error: 'Usuario ou senha invalidos.' });
  }
  attempts.delete(address);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { username, expiresAt: now + sessionDuration });
  saveSessions();
  const secure = request.secure || request.get('x-forwarded-proto') === 'https';
  response.setHeader(
    'Set-Cookie',
    `farmguard_session=${encodeURIComponent(`${token}.${signature(token)}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionDuration / 1000)}${secure ? '; Secure' : ''}`,
  );
  return response.json({ authenticated: true, username });
}

export function logout(request: Request, response: Response) {
  const id = sessionId(request);
  if (id && sessions.delete(id)) saveSessions();
  response.setHeader(
    'Set-Cookie',
    'farmguard_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
  );
  response.json({ authenticated: false });
}

export function authStatus(request: Request, response: Response) {
  const session = currentSession(request);
  response.json({
    enabled: config.authEnabled,
    authenticated: Boolean(session),
    username: session?.username || null,
  });
}
