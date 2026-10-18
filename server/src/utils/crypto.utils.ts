import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';

function getDerivedKey(): Buffer {
  const secret = env.JWT_ACCESS_SECRET || 'Neutronz_aes256_encryption_key_32b';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plain text string using AES-256-GCM (Authenticated Encryption).
 * Returns formatted payload string: enc_gcm:iv:authTag:ciphertext
 */
export function encryptText(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const key = getDerivedKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  return `enc_gcm:${iv.toString('base64')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted payload string.
 * Returns original plain text string.
 */
export function decryptText(encryptedText: string): string {
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.startsWith('enc_gcm:')) {
    return encryptedText; // Return as-is if plain text or legacy
  }

  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 4) return encryptedText;

    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = parts[3];
    const key = getDerivedKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.warn('Decryption warning:', err);
    return encryptedText;
  }
}

/**
 * Encrypts sensitive keys in configuration objects (e.g. passwords, connection strings, API keys).
 */
export function maskSensitiveConfig(config: Record<string, any>): Record<string, any> {
  if (!config) return config;
  const masked: Record<string, any> = { ...config };

  for (const key of Object.keys(masked)) {
    if (typeof masked[key] === 'string' && /password|pass|secret|key|connection|uri|url/i.test(key)) {
      masked[key] = encryptText(masked[key]);
    }
  }

  return masked;
}
