import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const JWT_SECRET = process.env.CASECOMP_JWT_SECRET;
const JWT_EXPIRY_MS = 24 * 60 * 60 * 1000;

const client = CLIENT_ID ? new OAuth2Client(CLIENT_ID) : null;

export async function verifyGoogleToken(idToken) {
  if (!client) throw new Error("Google OAuth not configured");
  const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
  const payload = ticket.getPayload();
  return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
}

function base64url(data) {
  return Buffer.from(data).toString("base64url");
}

function hmacSign(input) {
  return crypto.createHmac("sha256", JWT_SECRET).update(input).digest("base64url");
}

export function generateJwt(user) {
  if (!JWT_SECRET) throw new Error("JWT secret not configured");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: user.sub, email: user.email, iat: Date.now(), exp: Date.now() + JWT_EXPIRY_MS }));
  const signature = hmacSign(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token) {
  if (!JWT_SECRET || !token || token.split(".").length !== 3) return null;
  try {
    const [header, payload, signature] = token.split(".");
    const expected = hmacSign(`${header}.${payload}`);
    if (signature !== expected) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
