import { createCipheriv } from "node:crypto";

// AES-CMAC per RFC 4493. NTAG 424 DNA SDM uses AES-128 CMAC for both the
// session-key derivation and the SDMMAC, so correctness here is load-bearing.
// This module is validated against the RFC 4493 test vectors in selftest.ts.

const BLOCK = 16;
const Rb = 0x87;

function aesEcbEncryptBlock(key: Buffer, block: Buffer): Buffer {
  // Single-block AES-128 ECB, no padding. We feed exactly one 16-byte block.
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function leftShiftOneBit(input: Buffer): Buffer {
  const output = Buffer.alloc(input.length);
  let overflow = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    const byte = input[i] ?? 0;
    output[i] = ((byte << 1) & 0xff) | overflow;
    overflow = (byte & 0x80) !== 0 ? 1 : 0;
  }
  return output;
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
}

function generateSubkeys(key: Buffer): { k1: Buffer; k2: Buffer } {
  const L = aesEcbEncryptBlock(key, Buffer.alloc(BLOCK));

  let k1 = leftShiftOneBit(L);
  if ((L[0] ?? 0) & 0x80) k1[k1.length - 1] = (k1[k1.length - 1] ?? 0) ^ Rb;

  let k2 = leftShiftOneBit(k1);
  if ((k1[0] ?? 0) & 0x80) k2[k2.length - 1] = (k2[k2.length - 1] ?? 0) ^ Rb;

  return { k1, k2 };
}

/** Full 16-byte AES-128 CMAC over `message` with `key`. */
export function aesCmac(key: Buffer, message: Buffer): Buffer {
  if (key.length !== 16) throw new Error("AES-CMAC requires a 16-byte key");

  const { k1, k2 } = generateSubkeys(key);

  const n = Math.ceil(message.length / BLOCK);
  const completeLastBlock =
    n > 0 && message.length % BLOCK === 0 && message.length !== 0;

  let lastBlock: Buffer;
  if (n === 0) {
    // Empty message: single padded block XOR k2.
    const padded = Buffer.alloc(BLOCK);
    padded[0] = 0x80;
    lastBlock = xor(padded, k2);
  } else if (completeLastBlock) {
    lastBlock = xor(message.subarray((n - 1) * BLOCK, n * BLOCK), k1);
  } else {
    const remaining = message.subarray((n - 1) * BLOCK);
    const padded = Buffer.alloc(BLOCK);
    remaining.copy(padded);
    padded[remaining.length] = 0x80;
    lastBlock = xor(padded, k2);
  }

  let x: Buffer = Buffer.alloc(BLOCK);
  const blocks = Math.max(n, 1);
  for (let i = 0; i < blocks - 1; i++) {
    const block = message.subarray(i * BLOCK, (i + 1) * BLOCK);
    x = aesEcbEncryptBlock(key, xor(x, block));
  }
  return aesEcbEncryptBlock(key, xor(x, lastBlock));
}

/**
 * SDM truncation: the SDMMAC shown in the tag URL is the 8 odd-indexed bytes
 * (1,3,5,...,15) of the full CMAC. See NXP AN12196.
 */
export function sdmTruncate(fullCmac: Buffer): Buffer {
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) out[i] = fullCmac[2 * i + 1] ?? 0;
  return out;
}
