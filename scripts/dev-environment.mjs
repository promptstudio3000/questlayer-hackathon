// Keep the browser origin explicit so forwarded previews retain CSRF checks.
export function developmentEnvironment(environment = process.env) {
  const cloud = environment.CODESPACES === "true";
  if (cloud && (!environment.CODESPACE_NAME || !environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN)) {
    throw new Error("Codespaces preview requires its name and forwarding domain.");
  }
  const origin = environment.APP_ORIGIN || (cloud
    ? `https://${environment.CODESPACE_NAME}-5173.${environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : "http://127.0.0.1:5173");
  return { ...environment, APP_ORIGIN: origin, QUESTLAYER_DEV_ORIGIN: origin, HOST: environment.HOST || "127.0.0.1" };
}
