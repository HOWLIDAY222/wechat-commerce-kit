import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

// Evaluate only each route's actual Zod declaration. No route imports, login,
// database, provider requests, or consent-record writes execute in this suite.
const mainConsent = "current-main-policy-test-sentinel";
function routeSchema(relative: string, name: string): z.ZodType {
  const content = readFileSync(resolve(process.cwd(), relative), "utf8");
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      assert(declaration.initializer && ts.isCallExpression(declaration.initializer));
      assert.equal(declaration.initializer.expression.getText(source), "z.object");
      return runInNewContext(`(${declaration.initializer.getText(source)})`, {
        z, PRIVACY_POLICY_CONSENT_VERSION: mainConsent,
      }, { timeout: 1000 }) as z.ZodType;
    }
  }
  throw new Error(`Actual schema missing: ${relative}`);
}

const login = routeSchema("app/api/miniprogram/auth/wechat/route.ts", "inputSchema");
const phone = routeSchema("app/api/miniprogram/auth/link-phone/wechat/route.ts", "schema");
const input = (version: unknown) => ({
  code: "synthetic-no-provider-code", crossBorderConsent: true,
  privacyConsentVersion: mainConsent, miniProgramPrivacyVersion: version,
});

for (const version of ["miniapp-privacy-20260916", "miniapp-privacy-20260916-phone", "miniapp-privacy-20261013-contact"]) {
  test(`login preserves and accepts ${version}`, () => assert(login.safeParse(input(version)).success));
}
for (const version of ["miniapp-privacy-20260916-phone", "miniapp-privacy-20261013-contact"]) {
  test(`phone binding preserves and accepts ${version}`, () => assert(phone.safeParse(input(version)).success));
}
test("login accepts the new student notice while retaining old clients", () => assert(login.safeParse(input("community-miniapp-privacy-v1")).success));
test("phone binding accepts the new student notice while retaining old clients", () => assert(phone.safeParse(input("community-miniapp-privacy-v1")).success));
test("phone binding retains its previous rejection of base login-only privacy version", () => {
  assert.equal(phone.safeParse(input("miniapp-privacy-20260916")).success, false);
});
for (const [name, schema] of [["login", login], ["phone binding", phone]] as const) {
  for (const version of ["miniapp-privacy-unknown", "miniapp-privacy-20261014-contact", "", null, 20261013, undefined]) {
    test(`${name} rejects unrecognized or missing mini-program version ${String(version)}`, () => {
      assert.equal(schema.safeParse(input(version)).success, false);
    });
  }
  test(`${name} still requires current main-policy version`, () => {
    assert.equal(schema.safeParse({ ...input("miniapp-privacy-20261013-contact"), privacyConsentVersion: "outdated" }).success, false);
  });
  test(`${name} still requires affirmative cross-border consent`, () => {
    assert.equal(schema.safeParse({ ...input("miniapp-privacy-20261013-contact"), crossBorderConsent: false }).success, false);
  });
  test(`${name} still rejects an empty provider code`, () => {
    assert.equal(schema.safeParse({ ...input("miniapp-privacy-20261013-contact"), code: " " }).success, false);
  });
}
