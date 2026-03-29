import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, generateKeyPairSync, type KeyObject } from "crypto";

let privateKey: KeyObject | null = null;
let publicKey: KeyObject | null = null;

function getKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  if (privateKey && publicKey) return { privateKey, publicKey };

  const pem = process.env.ED25519_PRIVATE_KEY;
  if (pem) {
    privateKey = createPrivateKey(pem);
    publicKey = createPublicKey(privateKey);
  } else {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    console.warn(
      "[signer] No ED25519_PRIVATE_KEY in env — generated ephemeral key pair.",
      "Signatures will not persist across restarts. Set ED25519_PRIVATE_KEY in .env.",
      "\nPublic key:\n",
      publicKey.export({ type: "spki", format: "pem" })
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
