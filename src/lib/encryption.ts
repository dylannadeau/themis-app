import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (secret) {
    const buf = Buffer.from(secret, 'hex');
    if (buf.length === 32) {
      return buf;
    }
    // Invalid secret — log a warning and fall through to the anon-key fallback
    // so that encryption still works rather than blocking the user entirely.
    console.warn(
      `API_KEY_ENCRYPTION_SECRET is set but invalid (expected 32 bytes / 64 hex chars, got ${buf.length} bytes / ${secret.length} chars). Falling back to derived key. Generate a valid secret with: openssl rand -hex 32`
    );
  }

  // Derive a key from the Supabase anon key so encryption works without extra config
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      'Neither API_KEY_ENCRYPTION_SECRET nor NEXT_PUBLIC_SUPABASE_ANON_KEY is configured'
    );
  }
  return crypto.createHash('sha256').update(anonKey).digest();
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

export function decrypt(encryptedString: string): string {
  const key = getEncryptionKey();
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

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
