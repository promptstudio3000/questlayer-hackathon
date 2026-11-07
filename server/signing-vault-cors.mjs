const PATHS = [
  /^\/api\/gold\/burn\/intent$/,
  /^\/api\/market\/funding-intent$/,
  /^\/api\/account\/keys$/,
  /^\/api\/relay(?:\/prepare|\/relay_[a-f0-9-]{36})?$/,
  /^\/api\/auth\/near\/(?:challenge|verify)$/,
  /^\/api\/identity\/management\/(?:challenge|verify)$/,
  /^\/api\/identity\/recovery\/(?:challenge|verify)$/,
];
export function signingVaultOrigin(value, appOrigin) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.origin !== value ||
    value === appOrigin ||
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw Error(
      "SIGNING_VAULT_ORIGIN must be a separate exact HTTPS origin (or local loopback).",
    );
  return value;
}
export function vaultCors(req, res, path, origin) {
  if (
    !origin ||
    req.headers.origin !== origin ||
    !PATHS.some((p) => p.test(path))
  )
    return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    if (
      !["GET", "POST"].includes(req.headers["access-control-request-method"])
    ) {
      res.writeHead(405).end();
      return true;
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204).end();
  }
  return true;
}
