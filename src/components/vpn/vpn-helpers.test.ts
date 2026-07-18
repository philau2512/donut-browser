import { describe, expect, it } from "vitest";
import { buildWireGuardConfig } from "./vpn-form-dialog";
import { detectVpnType } from "./vpn-import-dialog";

describe("VPN pure helpers (VN-04/05 smoke)", () => {
  it("buildWireGuardConfig emits Interface + Peer blocks", () => {
    const conf = buildWireGuardConfig({
      name: "wg",
      privateKey: " PRIV ",
      address: "10.0.0.2/32",
      dns: "1.1.1.1",
      mtu: "1420",
      peerPublicKey: "PUB",
      peerEndpoint: "vpn.example:51820",
      allowedIps: "0.0.0.0/0",
      persistentKeepalive: "25",
      presharedKey: "",
    });
    expect(conf).toContain("[Interface]");
    expect(conf).toContain("PrivateKey = PRIV");
    expect(conf).toContain("Address = 10.0.0.2/32");
    expect(conf).toContain("DNS = 1.1.1.1");
    expect(conf).toContain("[Peer]");
    expect(conf).toContain("Endpoint = vpn.example:51820");
    expect(conf).toContain("PersistentKeepalive = 25");
    expect(conf).not.toContain("PresharedKey");
  });

  it("detectVpnType accepts WireGuard .conf and rejects garbage", () => {
    const ok = detectVpnType(
      "[Interface]\nPrivateKey = x\n[Peer]\nPublicKey = y\nEndpoint = 1.2.3.4:51820\n",
      "office.conf",
    );
    expect(ok.isVpn).toBe(true);
    expect(ok.type).toBe("WireGuard");
    expect(ok.endpoint).toBe("1.2.3.4:51820");

    const bad = detectVpnType("hello", "note.txt");
    expect(bad.isVpn).toBe(false);
    expect(bad.type).toBeNull();
  });
});
