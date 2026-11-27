const alias = /^bj-[0-9a-f]{16}$/;
const domain = "@members.invalid";

export function generatedLoginName(tokenDigest: string): string {
  return "bj-" + tokenDigest.slice(0, 16);
}

export function displayLoginName(email: string): string {
  if (!email.endsWith(domain)) return email;
  const name = email.slice(0, -domain.length);
  return alias.test(name) ? name : email;
}

export function normalizeLoginName(value: string): string {
  const name = value.trim().toLowerCase();
  return alias.test(name) ? name + domain : name;
}
