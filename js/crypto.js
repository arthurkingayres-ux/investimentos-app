// Decifra payload_b64 → plaintext (string) usando PIN.
// Paridade com src/output/crypto.py (PBKDF2-HMAC-SHA256 600k + AES-256-GCM).

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;

async function derivarChave(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(pin), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decifrar(payloadB64, pin) {
  const bytes = Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0));
  const salt = bytes.slice(0, SALT_LENGTH);
  const nonce = bytes.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
  const ciphertext = bytes.slice(SALT_LENGTH + NONCE_LENGTH);
  const key = await derivarChave(pin, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce }, key, ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

window.decifrar = decifrar;
