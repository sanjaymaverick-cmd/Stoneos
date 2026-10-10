import type { Role } from "@stoneos/contracts";
const all: Role[] = [
  "owner",
  "manager",
  "admin",
  "supervisor",
  "inventory",
  "sales",
  "operator",
  "accountant",
  "auditor",
];
const floor: Role[] = [
  "owner",
  "manager",
  "admin",
  "supervisor",
  "inventory",
  "sales",
];
const owners: Role[] = ["owner", "manager", "admin"];
const production: Role[] = [...floor, "operator"];
const money: Role[] = [...owners, "accountant", "auditor"];
export const routes: Array<{
  href: string;
  label: string;
  roles: Role[];
  nav?: boolean;
}> = [
  { href: "/dashboard", label: "Today", roles: all },
  { href: "/inventory", label: "Yard", roles: floor },
  { href: "/production", label: "Cut", roles: [...floor, "operator"] },
  { href: "/sales", label: "Sell", roles: floor },
  {
    href: "/sales/reports",
    label: "Party reports",
    roles: [...floor, ...money],
    nav: false,
  },
  { href: "/expenses", label: "Money", roles: money },
  { href: "/books", label: "Books", roles: money },
  {
    href: "/parties",
    label: "Buyers & suppliers",
    roles: [...floor, ...money],
    nav: false,
  },
  { href: "/consumables", label: "Consumables", roles: production, nav: false },
  {
    href: "/recovery-ratio",
    label: "Recovery & quality",
    roles: production,
    nav: false,
  },
  ...[
    {
      href: "/muster",
      label: "People / लोग",
      roles: [...floor, "operator"] as Role[],
    },
    {
      href: "/maintenance",
      label: "Machines",
      roles: [...floor, "operator"] as Role[],
    },
    { href: "/admin/users", label: "Team", roles: owners },
    { href: "/admin/audit", label: "Audit", roles: money },
    { href: "/books/openings", label: "Opening balances", roles: money },
    { href: "/books/import", label: "Import", roles: owners },
    { href: "/muster/payroll", label: "Payroll", roles: owners },
    { href: "/tally", label: "Tally archive", roles: owners },
    {
      href: "/analytics",
      label: "Business insights",
      roles: ["owner"] as Role[],
    },
    { href: "/intake", label: "Drafts", roles: owners },
    { href: "/files", label: "Attachments", roles: floor },
    { href: "/setup/opening-inventory", label: "Opening count", roles: owners },
    { href: "/lots", label: "Lots", roles: floor },
    { href: "/lots/sell", label: "Sell by lot", roles: floor },
    { href: "/lots/dispatch", label: "To dispatch", roles: floor },
    { href: "/sync", label: "Sync", roles: all },
  ].map((r) => ({ ...r, nav: false })),
];
export function visibleRoutes(role: Role) {
  return routes.filter((r) => r.nav !== false && r.roles.includes(role));
}
export function canAccessPath(role: Role, path: string) {
  const r = routes
    .filter((r) => path === r.href || path.startsWith(`${r.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return !r || r.roles.includes(role);
}
