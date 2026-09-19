import { decodeSun, type SunDecodeResult } from "./sdm";

export { decodeSun } from "./sdm";
export type { SunDecodeResult, SunKeys } from "./sdm";

function hexKey(name: string, fallback: string): Buffer {
  const raw = process.env[name] ?? fallback;
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 16) {
    throw new Error(`${name} must be 32 hex chars (16 bytes); got ${buf.length} bytes`);
  }
  return buf;
}

function appKeys() {
  return {
    metaReadKey: hexKey("NTAG_META_READ_KEY", "00000000000000000000000000000000"),
    fileReadKey: hexKey("NTAG_FILE_READ_KEY", "00000000000000000000000000000000"),
  };
}

export interface TapParams {
  picc: string;
  cmac: string;
  enc?: string;
}

/** Pull the SUN params out of a tapped URL using the configured param names. */
export function extractTapParams(url: URL): TapParams | null {
  const piccParam = process.env.NTAG_PICC_PARAM ?? "picc_data";
  const cmacParam = process.env.NTAG_CMAC_PARAM ?? "cmac";
  const encParam = process.env.NTAG_ENC_PARAM ?? "enc";

  const picc = url.searchParams.get(piccParam);
  const cmac = url.searchParams.get(cmacParam);
  if (!picc || !cmac) return null;

  const enc = url.searchParams.get(encParam) ?? undefined;
  return { picc, cmac, enc };
}

/** Verify a tap using the app-wide keys from the environment. */
export function verifyTap(params: TapParams): SunDecodeResult {
  return decodeSun(appKeys(), params.picc, params.cmac, params.enc);
}
