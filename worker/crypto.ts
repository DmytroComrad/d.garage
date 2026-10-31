const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toB64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

export const randomToken = (bytes = 32): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64Url(buf);
};

export const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toB64Url(new Uint8Array(digest));
};

export const safeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/** Максимум, який дозволяє WebCrypto у Workers. Сіль на кожен пароль, перець у секреті. */
const PBKDF2_ITERATIONS = 100_000;

const pepperKey = (pepper: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

const derive = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, pepper: string) => {
  const peppered = await crypto.subtle.sign("HMAC", await pepperKey(pepper), encoder.encode(password));
  const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
};

export const hashPassword = async (password: string, pepper: string): Promise<string> => {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS, pepper);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toB64Url(salt)}$${toB64Url(hash)}`;
};

export const verifyPassword = async (password: string, stored: string, pepper: string): Promise<boolean> => {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterations || !salt || !hash) return false;
  const actual = await derive(password, fromB64Url(salt), Number(iterations), pepper);
  return safeEqual(actual, fromB64Url(hash));
};

/** Для невідомої пошти: витрачаємо стільки ж часу, щоб за часом відповіді не вгадати, чи є акаунт. */
export const burnPasswordCheck = async (password: string, pepper: string): Promise<void> => {
  await derive(password, new Uint8Array(16), PBKDF2_ITERATIONS, pepper);
};

const tokenKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", fromB64Url(secret), "AES-GCM", false, ["encrypt", "decrypt"]);

/** AES-GCM із прив'язкою до користувача: зашифрований токен не можна підставити іншому акаунту. */
export const encryptToken = async (plain: string, secret: string, userId: string): Promise<string> => {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(userId) },
    await tokenKey(secret),
    encoder.encode(plain),
  );
  return `v1.${toB64Url(iv)}.${toB64Url(new Uint8Array(data))}`;
};

export const decryptToken = async (stored: string, secret: string, userId: string): Promise<string> => {
  const [version, iv, data] = stored.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("bad token format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64Url(iv), additionalData: encoder.encode(userId) },
    await tokenKey(secret),
    fromB64Url(data),
  );
  return decoder.decode(plain);
};

export const pkceChallenge = async (verifier: string): Promise<string> =>
  toB64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
