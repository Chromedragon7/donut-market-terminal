import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type { SellerPrivacyPolicy, SellerRecord, UserRole } from "./contracts.js";

const PASSWORD_VERSION = "v1";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_N = 16_384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
      { N: PASSWORD_N, r: PASSWORD_R, p: PASSWORD_P, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error !== null) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export interface SellerViewFull {
  display: "full";
  name: string | null;
  uuid: string | null;
}

export interface SellerViewName {
  display: "name";
  name: string | null;
}

export interface SellerViewPseudonymized {
  display: "pseudonymized";
  pseudonym: string;
}

export interface SellerViewHidden {
  display: "hidden";
}

export type SellerView = SellerViewFull | SellerViewName | SellerViewPseudonymized | SellerViewHidden;

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("Password length must be between 12 and 1024 characters");
  }
  const derived = await derivePassword(password, salt);
  return [
    "scrypt",
    PASSWORD_VERSION,
    `N=${PASSWORD_N},r=${PASSWORD_R},p=${PASSWORD_P},keylen=${PASSWORD_KEY_LENGTH}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const parts = encoded.split("$");
    if (parts.length !== 5 || parts[0] !== "scrypt" || parts[1] !== PASSWORD_VERSION) {
      return false;
    }
    const parameters = parts[2];
    const saltText = parts[3];
    const expectedText = parts[4];
    if (
      parameters !== `N=${PASSWORD_N},r=${PASSWORD_R},p=${PASSWORD_P},keylen=${PASSWORD_KEY_LENGTH}` ||
      saltText === undefined ||
      expectedText === undefined
    ) {
      return false;
    }
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(expectedText, "base64url");
    if (salt.length < 16 || expected.length !== PASSWORD_KEY_LENGTH) {
      return false;
    }
    const actual = await derivePassword(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function applySellerPrivacy(
  seller: SellerRecord,
  role: UserRole,
  requestedPolicy: SellerPrivacyPolicy,
  pseudonymSecret: string,
): SellerView {
  const policy: SellerPrivacyPolicy = role === "owner" ? "full" : requestedPolicy;
  if (policy === "full") {
    return { display: "full", name: seller.name, uuid: seller.uuid };
  }
  if (policy === "name") {
    return { display: "name", name: seller.name };
  }
  if (policy === "hidden") {
    return { display: "hidden" };
  }
  const stableInput = seller.uuid ?? seller.name ?? "unknown-seller";
  const digest = createHmac("sha256", pseudonymSecret).update(stableInput, "utf8").digest("hex");
  return { display: "pseudonymized", pseudonym: `Seller ${digest.slice(0, 10)}` };
}
