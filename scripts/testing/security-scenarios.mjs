import { readFile, writeFile } from "node:fs/promises";
const manifest = JSON.parse(
  await readFile("var/company-year/tokens.json", "utf8"),
);
const allowed = "5c183b6d-44b6-4e46-9744-3b705df6d38a";
if (
  manifest.factoryId !== allowed ||
  process.env.STONEOS_ALLOW_SYNTHETIC_ORACLE !== "yes"
)
  throw Error("Authorized test company required");
const rows = [];
async function req(role, method, path, body, token) {
  const r = await fetch(manifest.api + "/api/v1/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...((token ?? manifest.tokens[role])
        ? { Authorization: "Bearer " + (token ?? manifest.tokens[role]) }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, body: json };
}
const rec = (control, pass, status, path, note = "") => {
  rows.push({ control, result: pass ? "pass" : "fail", status, path, note });
  console.log(control + ": " + (pass ? "pass" : "fail") + " HTTP " + status);
};
for (const role of Object.keys(manifest.tokens)) {
  const r = await req(role, "GET", "auth/me");
  if (r.body?.factoryId !== allowed) throw Error("Wrong tenant identity");
}
let r = await req(null, "POST", "auth/login", {
  username: "dry20261005_operator",
  password: "WrongSyntheticPassword!",
});
rec("Bad password rejected", r.status === 401, r.status, "auth/login");
r = await req(null, "POST", "auth/signup", {
  username: "never_real",
  password: "InvalidSynthetic!",
});
rec("No public signup", r.status === 404, r.status, "auth/signup");
r = await req("operator", "POST", "admin/users", {
  username: "test_denied_operator",
  role: "operator",
});
rec("Operator cannot provision", r.status === 403, r.status, "admin/users");
r = await req("owner", "POST", "admin/users", {
  username: manifest.users.owner,
  role: "operator",
});
rec("Owner cannot demote self", r.status === 403, r.status, "admin/users");
r = await req("owner", "POST", "admin/users", {
  username: "dry20261005_temp_security",
  name: "DRY RUN temporary security test",
  role: "operator",
});
if (!r.body?.password)
  throw Error(
    "Temporary test account already exists; preserve current credentials",
  );
const temp = r.body,
  login = await req(null, "POST", "auth/login", {
    username: temp.user.username,
    password: temp.password,
  });
let token = login.body.token;
r = await req(
  "operator",
  "POST",
  "cutting-sessions",
  { rawBlockId: "invalid-test-id", machineId: "invalid-test-id" },
  token,
);
rec(
  "Temporary password blocks writes",
  r.status === 403,
  r.status,
  "cutting-sessions",
);
r = await req(
  "operator",
  "POST",
  "auth/change-password",
  { currentPassword: temp.password, newPassword: "SyntheticChanged_2026!" },
  token,
);
rec(
  "Temporary password can be changed",
  r.status === 200,
  r.status,
  "auth/change-password",
);
token = r.body.token;
r = await req(
  "operator",
  "POST",
  "cutting-sessions",
  { rawBlockId: "invalid-test-id", machineId: "invalid-test-id" },
  token,
);
rec(
  "After change role validation reached safely",
  r.status === 404,
  r.status,
  "cutting-sessions",
);
r = await req("operator", "POST", "auth/logout", {}, token);
rec("Logout completes", r.status === 200, r.status, "auth/logout");
r = await req("operator", "GET", "auth/me", undefined, token);
rec("Logged-out token rejected", r.status === 401, r.status, "auth/me");
r = await req("auditor", "GET", "reports/dashboard");
rec("Auditor dashboard read", r.status === 200, r.status, "reports/dashboard");
r = await req("auditor", "POST", "expenses", {
  category: "other",
  amount: 1,
  expenseDate: "2026-10-05",
});
rec("Auditor expense denied", r.status === 403, r.status, "expenses");
r = await req("accountant", "POST", "expenses", {
  category: "other",
  amount: 1,
  expenseDate: "2026-10-05",
});
rec(
  "Historic accountant remains read-only",
  r.status === 403,
  r.status,
  "expenses",
);
r = await req("owner", "GET", "inventory/raw-blocks");
rec(
  "Raw-block listing is test-company scoped",
  r.status === 200 && r.body.every((b) => b.factoryId === allowed),
  r.status,
  "inventory/raw-blocks",
);
r = await req("owner", "POST", "inventory/raw-blocks", {
  serialNumber: "DEMO-SECURITY-FORGED-TENANT",
  varietyName: "Kotda black",
  weightTons: 1,
  factoryId: "forged-other-company",
  clientOpId: "oracle-20261005-forged-tenant",
});
rec(
  "Body factoryId ignored",
  r.status === 201 && (r.body.block ?? r.body)?.factoryId === allowed,
  r.status,
  "inventory/raw-blocks",
);
const me = await req("manager", "GET", "auth/me");
rec(
  "Manager compatibility behavior documented",
  me.status === 200 && me.body.role === "owner",
  me.status,
  "auth/me",
  "Persisted manager maps to effective owner; distinct manager hierarchy is not implemented in current daily access.",
);
const audit = await req("owner", "GET", "audit");
rec("Test-company audit readable", audit.status === 200, audit.status, "audit");
await writeFile(
  "var/company-year/security-workflow-review.json",
  JSON.stringify({ factoryId: allowed, rows }, null, 2),
);
await writeFile(
  "var/company-year/security-workflow-review.md",
  "# Oracle test-company security review\n\n| Control | Result | HTTP | Endpoint | Note |\n|---|---|---|---|---|\n" +
    rows
      .map(
        (r) =>
          `| ${r.control} | ${r.result} | ${r.status} | ${r.path} | ${r.note} |`,
      )
      .join("\n") +
    "\n",
);
