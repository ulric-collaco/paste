import { getCookie } from 'hono/cookie';
import { ApiError, ErrorCode } from './errors.js';

// ── Raw Web Crypto JWT (HMAC-SHA256) ──────────────────────────────────────
// hono/jwt requires CryptoKey objects in newer CF runtimes.
// This implementation uses the Web Crypto API directly and is guaranteed
// to work in all Cloudflare Workers environments.

function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function parseB64url(str) {
    return Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function getKey(secret) {
    const enc = new TextEncoder();
    return crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign', 'verify']
    );
}

export const generateToken = async (payload, secret) => {
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body   = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const key    = await getKey(secret);
    const sig    = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
    return `${header}.${body}.${b64url(sig)}`;
};

export const verifyToken = async (token, secret) => {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [header, body, sig] = parts;
        const key = await getKey(secret);
        const valid = await crypto.subtle.verify(
            'HMAC', key,
            parseB64url(sig),
            new TextEncoder().encode(`${header}.${body}`)
        );
        if (!valid) return null;
        return JSON.parse(new TextDecoder().decode(parseB64url(body)));
    } catch {
        return null;
    }
};

export const authMiddleware = () => {
    return async (c, next) => {
        const authHeader = c.req.header('Authorization');
        const token = authHeader?.replace('Bearer ', '') || getCookie(c, 'session_token');
        
        if (!token) throw new ApiError(ErrorCode.UNAUTHORIZED, 'Unauthorized', 401);
        
        const secret = c.env.TOKEN_SECRET || 'fallback-secret-change-me';
        const payload = await verifyToken(token, secret);
        
        if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
            throw new ApiError(ErrorCode.UNAUTHORIZED, 'Token expired or invalid', 401);
        }
        
        c.set('userId', payload.userId || payload.passcode);
        c.set('passcode', payload.passcode);
        
        await next();
    };
};

export const requestLogger = () => {
    return async (c, next) => {
        const requestId = crypto.randomUUID();
        c.set('requestId', requestId);
        c.header('X-Request-Id', requestId);
        
        const start = Date.now();
        const method = c.req.method;
        const path = c.req.path;
        const ip = c.req.header('CF-Connecting-IP') || 'anonymous';
        
        await next();
        
        const duration = Date.now() - start;
        const status = c.res.status;
        
        const logLine = {
            requestId,
            method,
            path,
            status,
            durationMs: duration,
            ip,
            userAgent: c.req.header('User-Agent'),
            timestamp: new Date().toISOString(),
        };
        console.log(JSON.stringify(logLine));
    };
};

export const createRateLimiter = (options = {}) => rateLimiter({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (c) => c.req.header('CF-Connecting-IP') || 'anonymous',
    handler: (c) => {
       return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429)
    },
    ...options
});
