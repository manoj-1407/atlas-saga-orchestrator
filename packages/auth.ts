
import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

/**
 * Authentication & Authorization Module for Atlas Workflow Engine
 *
 * Supports:
 * 1. API Key authorization (`x-api-key` header or `Bearer <key>`)
 * 2. Role-Based Access Control (RBAC) with Admin, Operator, Viewer tiers
 * 3. Constant-time comparison to defeat timing-oracle attacks
 *
 * SECURITY NOTE — Role derivation:
 *   Roles are derived entirely server-side from the presented API key using a
 *   static key→role mapping (ATLAS_API_KEY_ROLES env var or the built-in map
 *   below). The client NEVER supplies or influences its own role. The former
 *   `x-user-role` header has been removed; sending it has no effect.
 *
 * Key→Role mapping format (ATLAS_API_KEY_ROLES env var):
 *   A comma-separated list of `key:role` pairs, e.g.:
 *     atl_abc123:admin,atl_def456:operator,atl_ghi789:viewer
 *   If the env var is absent, the single ATLAS_API_KEY value is treated as
 *   an admin key (backward-compatible with single-key deployments).
 */

export type UserRole = 'admin' | 'operator' | 'viewer'

export interface AuthContext {
  userId: string
  role: UserRole
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

/** Parse ATLAS_API_KEY_ROLES into a Map<apiKey, role> at startup. */
function buildKeyRoleMap(): Map<string, UserRole> {
  const map = new Map<string, UserRole>()
  const rolesEnv = process.env.ATLAS_API_KEY_ROLES || ''
  if (rolesEnv) {
    for (const pair of rolesEnv.split(',')) {
      const [k, v] = pair.trim().split(':')
      if (k && v && ['admin', 'operator', 'viewer'].includes(v)) {
        map.set(k.trim(), v.trim() as UserRole)
      }
    }
  }
  // Fall back: treat the single ATLAS_API_KEY as admin
  const singleKey = process.env.ATLAS_API_KEY || ''
  if (singleKey && !map.has(singleKey)) {
    map.set(singleKey, 'admin')
  }
  return map
}

// Build once at module load time (static for the lifetime of the process).
const KEY_ROLE_MAP = buildKeyRoleMap()

/** Extract the bearer/api-key token from the request. */
function extractToken(req: Request): string {
  const headerKey = req.headers['x-api-key'] as string | undefined
  if (headerKey) return headerKey.trim()
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return ''
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Dev-mode bypass: no keys configured at all
  if (KEY_ROLE_MAP.size === 0) {
    req.auth = { userId: 'dev-user', role: 'admin' }
    next()
    return
  }

  const provided = extractToken(req)
  if (!provided) {
    res.status(401).json({ error: 'Unauthorized', hint: 'Provide x-api-key or Authorization: Bearer <key>' })
    return
  }

  // Constant-time check against every key to avoid timing oracle across key set.
  // We do a linear scan and accept the FIRST matching key; all comparisons run
  // even after a match to prevent short-circuit timing leaks.
  let matchedRole: UserRole | null = null
  for (const [key, role] of KEY_ROLE_MAP.entries()) {
    if (timingSafeEqual(provided, key)) {
      matchedRole = role
      // Do NOT break — continue scanning to make timing uniform across key count.
    }
  }

  if (!matchedRole) {
    res.status(401).json({ error: 'Unauthorized', hint: 'Invalid API key' })
    return
  }

  req.auth = { userId: `key:${provided.slice(0, 8)}…`, role: matchedRole }
  next()
}

/**
 * Middleware factory to enforce specific RBAC role requirements.
 * Roles are compared against the server-assigned role from authMiddleware.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.auth.role}' lacks required permissions (needs: ${allowedRoles.join(' | ')})`,
      })
      return
    }
    next()
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  // Pad to same length so crypto.timingSafeEqual doesn't throw; use constant
  // max length to avoid leaking length information via exception.
  const maxLen = Math.max(a.length, b.length, 1)
  const bufA = Buffer.alloc(maxLen)
  const bufB = Buffer.alloc(maxLen)
  bufA.write(a)
  bufB.write(b)
  return crypto.timingSafeEqual(bufA, bufB) && a.length === b.length
}

/** Generate a cryptographically secure API key. */
export function generateApiKey(): string {
  return 'atl_' + crypto.randomBytes(32).toString('hex')
}
