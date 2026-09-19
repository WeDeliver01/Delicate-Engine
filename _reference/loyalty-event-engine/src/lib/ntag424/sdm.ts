import { createDecipheriv, timingSafeEqual } from "node:crypto";
import { aesCmac, sdmTruncate } from "./aes-cmac";

// NTAG 424 DNA Secure Dynamic Messaging (SDM), "encrypted PICC + CMAC" layout.
// References: NXP AN12196, NXP AN10922. Each tap produces a URL with:
//   - PICCData: AES-128-CBC encrypted (IV = 0), decrypts to tag byte + UID + counter
//   - SDMMAC : 8-byte truncated CMAC proving the tap is authentic and fresh
//
// We decrypt the PICC data, then derive the per-tap session MAC key and verify
// the SDMMAC. The caller is responsible for the monotonic-counter check against
// stored state (that lives in the tag resolver, since it needs the database).

export interface SunDecodeResult {
  uid: string; // hex, lowercase, 7 bytes
  readCounter: number; // SDMReadCtr, increments on every tap
  macValid: boolean;
}

export interface SunKeys {
  metaReadKey: Buffer; // KSDMMetaRead (decrypts PICC data)
  fileReadKey: Buffer; // KSDMFileRead (authenticates the tap)
}

function decryptPicc(metaReadKey: Buffer, piccData: Buffer): Buffer {
  if (piccData.length !== 16) {
    throw new Error(`PICC data must be 16 bytes, got ${piccData.length}`);
  }
  const decipher = createDecipheriv("aes-128-cbc", metaReadKey, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(piccData), decipher.final()]);
}

/**
 * Parse decrypted PICC bytes.
 * Byte 0 is the PICCDataTag: bit7 (0x80) = UID mirrored, bit6 (0x40) = counter
 * mirrored, low nibble = UID length. Standard encoding is 0xC7 (UID 7 bytes +
 * counter present).
 */
function parsePicc(plain: Buffer): { uid: Buffer; readCounter: number } {
  const tagByte = plain[0] ?? 0;
  const uidPresent = (tagByte & 0x80) !== 0;
  const ctrPresent = (tagByte & 0x40) !== 0;
  const uidLen = tagByte & 0x0f;

  if (!uidPresent || uidLen === 0) {
    throw new Error("PICC data does not contain a mirrored UID");
  }
  let offset = 1;
  const uid = plain.subarray(offset, offset + uidLen);
  offset += uidLen;

  let readCounter = 0;
  if (ctrPresent) {
    // SDMReadCtr is 3 bytes, least-significant byte first.
    const c0 = plain[offset] ?? 0;
    const c1 = plain[offset + 1] ?? 0;
    const c2 = plain[offset + 2] ?? 0;
    readCounter = c0 | (c1 << 8) | (c2 << 16);
  }
  return { uid, readCounter };
}

/**
 * Derive the per-tap session MAC key, then compute the expected SDMMAC.
 * SV2 = 3C C3 00 01 00 80 || UID || SDMReadCtr  (AN12196).
 * KSesSDMFileReadMAC = CMAC(KSDMFileRead, SV2)
 * SDMMAC = truncate( CMAC(KSesSDMFileReadMAC, message) )
 * For the no-encrypted-file layout, `message` is empty.
 */
function computeSdmMac(
  fileReadKey: Buffer,
  uid: Buffer,
  readCounter: number,
  message: Buffer,
): Buffer {
  const ctr = Buffer.from([
    readCounter & 0xff,
    (readCounter >> 8) & 0xff,
    (readCounter >> 16) & 0xff,
  ]);
  const sv2 = Buffer.concat([
    Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]),
    uid,
    ctr,
  ]);
  const sessionKey = aesCmac(fileReadKey, sv2);
  return sdmTruncate(aesCmac(sessionKey, message));
}

/**
 * Decode and authenticate a SUN tap.
 * @param piccHex   hex of the encrypted PICC data param
 * @param cmacHex   hex of the SDMMAC param (8 bytes = 16 hex chars)
 * @param encHex    optional hex of encrypted file data (mirrored "enc" param)
 */
export function decodeSun(
  keys: SunKeys,
  piccHex: string,
  cmacHex: string,
  encHex?: string,
): SunDecodeResult {
  const piccData = Buffer.from(piccHex, "hex");
  const providedMac = Buffer.from(cmacHex, "hex");

  const plain = decryptPicc(keys.metaReadKey, piccData);
  const { uid, readCounter } = parsePicc(plain);

  // The CMAC message is the encrypted file data when present, else empty.
  const message = encHex ? Buffer.from(encHex, "hex") : Buffer.alloc(0);
  const expectedMac = computeSdmMac(keys.fileReadKey, uid, readCounter, message);

  const macValid =
    providedMac.length === expectedMac.length &&
    timingSafeEqual(providedMac, expectedMac);

  return { uid: uid.toString("hex").toLowerCase(), readCounter, macValid };
}
