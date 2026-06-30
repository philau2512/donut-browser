import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CloseProfileForm } from "./close-profile-form";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="profile-select"
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: () => null,
}));

describe("CloseProfileForm", () => {
  it("shows destructive alert when full cleanup selected", () => {
    render(
      <CloseProfileForm
        value={{ profileId: "p1", cleanupMode: "full" }}
        onChange={vi.fn()}
        profiles={[
          {
            id: "p1",
            name: "P1",
            browser: "wayfern",
            version: "1",
            release_type: "stable",
          },
        ]}
      />,
    );
    expect(
      screen.getByText(/destructive and irreversible/i),
    ).toBeInTheDocument();
  });

  it("shows variable validation badge when provided", () => {
    render(
      <CloseProfileForm
        value={{ profileId: "p1", cleanupMode: "cookies" }}
        onChange={vi.fn()}
        profiles={[]}
        variableWarnings={[
          { type: "error", message: "Variable {{FOO}} missing" },
        ]}
      />,
    );
    expect(screen.getByText(/1 issue/)).toBeInTheDocument();
  });

  it("calls onChange when profile selected", () => {
    const onChange = vi.fn();
    render(
      <CloseProfileForm
        value={{ profileId: "", cleanupMode: "cookies" }}
        onChange={onChange}
        profiles={[
          {
            id: "a",
            name: "A",
            browser: "wayfern",
            version: "1",
            release_type: "stable",
          },
          {
            id: "b",
            name: "B",
            browser: "wayfern",
            version: "1",
            release_type: "stable",
          },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText("profile-select"), {
      target: { value: "b" },
    });
    expect(onChange).toHaveBeenCalledWith({
      profileId: "b",
      cleanupMode: "cookies",
    });
  });
});
