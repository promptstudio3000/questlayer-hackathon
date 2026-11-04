// HTTP routes of the on-chain ledger (docs/CHAIN-LEDGER.md):
//   GET /api/chain/actions?limit=50   the signed-in player's recent records
//   GET /api/chain/actions/:id        one record: status, tx, explorer, proof
//   GET /api/chain/profile            the on-chain profile (QXP, level, QGOLD)
const ONE = /^\/api\/chain\/actions\/(ca_[a-z0-9]{6,40})$/;

export function createChainLedgerRoutes(
  ledger,
  { chain = () => null, linkedAccount = () => null } = {},
) {
  return {
    async handle(req, res, url, { player, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/chain/")) return false;
      if (method !== "GET") return false;
      if (
        path !== "/api/chain/actions" &&
        path !== "/api/chain/profile" &&
        !ONE.test(path)
      )
        return false;
      if (!ledger) {
        respond(res, { enabled: false, mode: "off" });
        return true;
      }
      assert(player, "Sign in to see your on-chain record.", 401, "AUTH");
      if (path === "/api/chain/actions") {
        const limit = Number(url.searchParams.get("limit")) || 50;
        respond(res, {
          enabled: true,
          mode: ledger.settings.mode,
          actions: ledger.list(player, limit),
        });
        return true;
      }
      if (path === "/api/chain/profile") {
        const c = chain(),
          account = linkedAccount(player);
        const base = {
          enabled: true,
          mode: ledger.settings.mode,
          account,
          contract: c?.contractId || null,
          goldToken: c?.goldToken || null,
        };
        if (!account || !c?.contractId) {
          respond(res, { ...base, profile: null });
          return true;
        }
        const profile = await c
          .view("profile", { account_id: account })
          .catch(() => null);
        respond(res, { ...base, profile });
        return true;
      }
      const one = ONE.exec(path);
      const action = ledger.get(one[1], player);
      assert(
        action,
        "This record is not yours or does not exist.",
        404,
        "NOT_FOUND",
      );
      respond(res, action);
      return true;
    },
  };
}
