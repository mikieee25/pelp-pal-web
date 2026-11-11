import { describe, expect, it } from "vitest";
import {
  GUEST_ACCOUNT_LIFETIME_DAYS,
  catalogRoleForAccount,
  guestExpiresAt,
  isAccountExpired,
} from "@/features/auth/account-policy";

describe("account policy", () => {
  it("gives guest accounts the EPRED catalog scope", () => {
    expect(catalogRoleForAccount("guest")).toBe("masterlist");
    expect(catalogRoleForAccount("epred")).toBe("masterlist");
  });

  it("expires guest accounts exactly one week after creation", () => {
    expect(GUEST_ACCOUNT_LIFETIME_DAYS).toBe(7);
    expect(guestExpiresAt("2026-10-26T00:00:00.000Z")).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect(
      isAccountExpired(
        "guest",
        "2026-11-02T00:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      isAccountExpired(
        "epred",
        "2026-10-01T00:00:00.000Z",
        "2027-01-01T00:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      isAccountExpired("guest", undefined, "2026-10-26T00:00:00.000Z"),
    ).toBe(true);
  });
});
