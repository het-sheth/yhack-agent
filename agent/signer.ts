import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, generateKeyPairSync, type KeyObject } from "crypto";

let privateKey: KeyObject | null = null;
let publicKey: KeyObject | null = null;

function getKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  if (privateKey && publicKey) return { privateKey, publicKey };

  const pem = process.env.ED25519_PRIVATE_KEY;
  if (pem) {
    // Normalize escaped newlines from .env single-line format
    const normalizedPem = pem.replace(/\\n/g, "\n");
    privateKey = createPrivateKey(normalizedPem);
    publicKey = createPublicKey(privateKey);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[signer] ED25519_PRIVATE_KEY is not set. Refusing to generate ephemeral key in production."
    );
  } else {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    const pubPem = publicKey.export({ type: "spki", format: "pem" });
    console.warn(
      "[signer] No ED25519_PRIVATE_KEY in env — generated ephemeral key pair.",
      "Set ED25519_PRIVATE_KEY for persistence.",
      "Ephemeral public key:\n",
      pubPem
    );
  }

  return { privateKey, publicKey };
}

export function sign(data: string): string {
  const { privateKey: key } = getKeyPair();
  const sig = cryptoSign(null, Buffer.from(data), key);
  return sig.toString("hex");
}

export function verify(data: string, signature: string): boolean {
  const { publicKey: key } = getKeyPair();
  return cryptoVerify(null, Buffer.from(data), key, Buffer.from(signature, "hex"));
}

export function getPublicKey(): KeyObject {
  return getKeyPair().publicKey;
}
