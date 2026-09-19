import "dotenv/config";
import { decodeSun, type SunKeys } from "../lib/ntag424";

// Validate the SDM (SUN) layer against a REAL tap from one of your tags. The
// CMAC primitive is already proven against RFC 4493 vectors (npm run
// ntag:selftest); this confirms the full decode path with your actual keys.
//
// Usage:
//   npm run ntag:verify -- "<full tapped URL>"
//   npm run ntag:verify -- --picc <hex> --cmac <hex> [--enc <hex>]
//
// Keys come from NTAG_META_READ_KEY / NTAG_FILE_READ_KEY in your environment
// (or override with --meta-key / --file-key).

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function keyFrom(name: string, envName: string): Buffer {
  const hex = arg(name) ?? process.env[envName] ?? "00000000000000000000000000000000";
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 16) throw new Error(`${name}/${envName} must be 32 hex chars`);
  return buf;
}

function fromUrl(raw: string): { picc?: string; cmac?: string; enc?: string } {
  const url = new URL(raw);
  const picc = process.env.NTAG_PICC_PARAM ?? "picc_data";
  const cmac = process.env.NTAG_CMAC_PARAM ?? "cmac";
  const enc = process.env.NTAG_ENC_PARAM ?? "enc";
  return {
    picc: url.searchParams.get(picc) ?? undefined,
    cmac: url.searchParams.get(cmac) ?? undefined,
    enc: url.searchParams.get(enc) ?? undefined,
  };
}

function main() {
  const positional = process.argv[2];
  let picc = arg("--picc");
  let cmac = arg("--cmac");
  let enc = arg("--enc");

  if (positional && positional.startsWith("http")) {
    const parsed = fromUrl(positional);
    picc = picc ?? parsed.picc;
    cmac = cmac ?? parsed.cmac;
    enc = enc ?? parsed.enc;
  }

  if (!picc || !cmac) {
    console.error("Provide a tapped URL or --picc <hex> --cmac <hex>.");
    process.exit(1);
  }

  const keys: SunKeys = {
    metaReadKey: keyFrom("--meta-key", "NTAG_META_READ_KEY"),
    fileReadKey: keyFrom("--file-key", "NTAG_FILE_READ_KEY"),
  };

  const result = decodeSun(keys, picc, cmac, enc);
  console.log("UID         :", result.uid);
  console.log("Read counter:", result.readCounter);
  console.log("MAC valid   :", result.macValid ? "YES" : "NO");
  if (!result.macValid) {
    console.log("\nMAC failed. Check that NTAG_META_READ_KEY / NTAG_FILE_READ_KEY match");
    console.log("the keys the tag was personalized with, and that the param names match");
    console.log("your encoder's mirror layout.");
    process.exit(2);
  }
}

main();
