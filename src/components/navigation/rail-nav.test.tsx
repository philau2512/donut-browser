import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RailNav } from "./rail-nav";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

vi.mock("../icons/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));

describe("RailNav (SH-02 smoke)", () => {
  it("renders core pages and navigates on click", () => {
    const onNavigate = vi.fn();
    render(
      <RailNav
        currentPage="profiles"
        onNavigate={onNavigate}
        totalProfiles={3}
        runningProfilesCount={1}
      />,
    );

    // Labels use fallback English from t(key, fallback)
    expect(screen.getByText("Profiles")).toBeTruthy();
    expect(screen.getByText("Proxies")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();

    fireEvent.click(screen.getByText("Proxies"));
    expect(onNavigate).toHaveBeenCalledWith("proxies");
  });
});
