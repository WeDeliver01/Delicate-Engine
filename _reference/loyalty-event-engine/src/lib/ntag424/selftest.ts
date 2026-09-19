import { aesCmac } from "./aes-cmac";

// RFC 4493 test vectors. If these pass, the CMAC primitive underneath the SDM
// verifier is correct. The SDM layer itself is validated against a real tap via
// `npm run ntag:verify` (see scripts/verify-tap.ts), because hardware keys and
// counters are needed and cannot be faked safely.

const key = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");

const cases: Array<{ name: string; msg: string; expected: string }> = [
  {
    name: "Example 1 (len 0)",
    msg: "",
    expected: "bb1d6929e95937287fa37d129b756746",
  },
  {
    name: "Example 2 (len 16)",
    msg: "6bc1bee22e409f96e93d7e117393172a",
    expected: "070a16b46b4d4144f79bdd9dd04a287c",
  },
  {
    name: "Example 3 (len 40)",
    msg:
      "6bc1bee22e409f96e93d7e117393172a" +
      "ae2d8a571e03ac9c9eb76fac45af8e51" +
      "30c81c46a35ce411",
    expected: "dfa66747de9ae63030ca32611497c827",
  },
  {
    name: "Example 4 (len 64)",
    msg:
      "6bc1bee22e409f96e93d7e117393172a" +
      "ae2d8a571e03ac9c9eb76fac45af8e51" +
      "30c81c46a35ce411e5fbc1191a0a52ef" +
      "f69f2445df4f9b17ad2b417be66c3710",
    expected: "51f0bebf7e3b9d92fc49741779363cfe",
  },
];

let failures = 0;
for (const c of cases) {
  const got = aesCmac(key, Buffer.from(c.msg, "hex")).toString("hex");
  const ok = got === c.expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) {
    console.log(`   expected ${c.expected}`);
    console.log(`   got      ${got}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} CMAC test(s) failed. Do not deploy until fixed.`);
  process.exit(1);
}
console.log("\nAll AES-CMAC vectors passed.");
