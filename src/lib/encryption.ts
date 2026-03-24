import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get the primary encryption key (explicit secret, or derived from anon key).
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (secret) {
    const buf = Buffer.from(secret, 'hex');
    if (buf.length === 32) {
      return buf;
    }
    console.warn(
      `API_KEY_ENCRYPTION_SECRET is set but invalid (expected 32 bytes / 64 hex chars, got ${buf.length} bytes / ${secret.length} chars). Falling back to derived key. Generate a valid secret with: openssl rand -hex 32`
    );
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      'Neither API_KEY_ENCRYPTION_SECRET nor NEXT_PUBLIC_SUPABASE_ANON_KEY is configured'
    );
  }
  return crypto.createHash('sha256').update(anonKey).digest();
}

/**
 * Get the derived (anon key) encryption key, or null if unavailable.
 */
function getDerivedKey(): Buffer | null {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return null;
  return crypto.createHash('sha256').update(anonKey).digest();
}

/**
 * Get the explicit secret key, or null if not set / invalid.
 */
function getExplicitKey(): Buffer | null {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) return null;
  const buf = Buffer.from(secret, 'hex');
  return buf.length === 32 ? buf : null;
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Store as iv:tag:ciphertext
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decryptWithKey(encryptedString: string, key: Buffer): string {
  const [ivHex, tagHex, ciphertext] = encryptedString.split(':');

  if (!ivHex || !tagHex || !ciphertext) {
    throw new Error('Invalid encrypted string format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Decrypt an encrypted string. Tries the primary key first, then falls back
 * to the alternate key (explicit secret ↔ derived key) in case the key was
 * encrypted under a different configuration.
 */
export function decrypt(encryptedString: string): string {
  const primaryKey = getEncryptionKey();

  try {
    return decryptWithKey(encryptedString, primaryKey);
  } catch (primaryErr) {
    // Try the alternate key: if primary is the explicit secret, try derived; and vice versa
    const explicitKey = getExplicitKey();
    const derivedKey = getDerivedKey();

    // Determine the fallback key (whichever one is NOT the primary)
    let fallbackKey: Buffer | null = null;
    if (explicitKey && primaryKey.equals(explicitKey) && derivedKey) {
      fallbackKey = derivedKey;
    } else if (derivedKey && primaryKey.equals(derivedKey) && explicitKey) {
      fallbackKey = explicitKey;
    }

    if (fallbackKey) {
      try {
        const result = decryptWithKey(encryptedString, fallbackKey);
        console.warn(
          'API key was decrypted using the fallback key. ' +
          'The key was likely encrypted under a different API_KEY_ENCRYPTION_SECRET. ' +
          'Re-save your API key in Settings to re-encrypt it with the current key.'
        );
        return result;
      } catch {
        // Both keys failed — throw the original error
      }
    }

    throw primaryErr;
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
