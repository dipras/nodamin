// ============================================================
// Nodamin - Session Management
// ============================================================
// Handles user sessions with secure cookies and per-session data storage

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const SESSION_COOKIE_NAME = "nodamin_session";
const SESSION_TIMEOUT = 3600000; // 1 hour in milliseconds

interface SessionData {
  id: string;
  createdAt: number;
  lastAccessedAt: number;
}

// Store sessions in memory (Map<sessionId, SessionData>)
const sessions = new Map<string, SessionData>();

/**
 * Generate a cryptographically secure random session ID
 */
export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Parse cookies from request headers
 */
function parseCookies(req: IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;
  
  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.split("=");
    const value = rest.join("=").trim();
    if (name) {
      cookies[name.trim()] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * Get session ID from request cookie, or null if not found
 */
export function getSessionIdFromRequest(req: IncomingMessage): string | null {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  
  if (!sessionId) return null;

  // Check if session exists and is not expired
  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = Date.now();
  if (now - session.lastAccessedAt > SESSION_TIMEOUT) {
    // Session expired, clean it up
    destroySession(sessionId);
    return null;
  }

  // Update last accessed time
  session.lastAccessedAt = now;
  return sessionId;
}

/**
 * Create a new session and set cookie in response
 */
export function createSession(res: ServerResponse): string {
  const sessionId = generateSessionId();
  const now = Date.now();

  sessions.set(sessionId, {
    id: sessionId,
    createdAt: now,
    lastAccessedAt: now,
  });

  // Set secure cookie (HttpOnly to prevent XSS attacks)
  const cookieValue = `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`;
  res.setHeader("Set-Cookie", cookieValue);

  return sessionId;
}

/**
 * Destroy a session and clear cookie
 */
export function destroySession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Clear session cookie in response
 */
export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/**
 * Check if a session exists and is valid
 */
export function isValidSession(sessionId: string | null): boolean {
  if (!sessionId) return false;
  
  const session = sessions.get(sessionId);
  if (!session) return false;

  const now = Date.now();
  return now - session.lastAccessedAt <= SESSION_TIMEOUT;
}

/**
 * Clean up expired sessions (should be called periodically)
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastAccessedAt > SESSION_TIMEOUT) {
      sessions.delete(sessionId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 300000);
