import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenProfileForm } from "./open-profile-form";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("OpenProfileForm", () => {
  const onChange = vi.fn();

  it("allows empty profileId (override is optional) and shows help", () => {
    render(
      <OpenProfileForm
        value={{ profileId: "", automation: "" }}
        onChange={onChange}
        profiles={[]}
      />,
    );
    expect(
      screen.getByPlaceholderText("{{PROFILE_ID}} or profile name"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("automation.nodes.openProfile.params.profileIdHelp"),
    ).toBeInTheDocument();
  });

  it("renders browser settings accordion sections", () => {
    render(
      <OpenProfileForm
        value={{ profileId: "p1", automation: "" }}
        onChange={onChange}
        profiles={[
          {
            id: "p1",
            name: "One",
            browser: "wayfern",
            version: "1",
            release_type: "stable",
          },
        ]}
      />,
    );
    expect(screen.getByText("Browser Settings Override")).toBeInTheDocument();
    expect(screen.getByText("Proxy settings")).toBeInTheDocument();
    expect(screen.getByText("Security settings")).toBeInTheDocument();
    expect(screen.getByText("WebRTC settings")).toBeInTheDocument();
    expect(screen.getByText("Custom DNS")).toBeInTheDocument();
    expect(screen.getByText("IP detection")).toBeInTheDocument();
    expect(screen.getByText("IP information")).toBeInTheDocument();
  });

  it("merges variable timeline warnings into badge", () => {
    render(
      <OpenProfileForm
        value={{ profileId: "p1", automation: "" }}
        onChange={onChange}
        profiles={[]}
        variableWarnings={[
          {
            type: "error",
            message:
              "Variable {{PROXY_IP}} is not available before this step in the flow",
          },
        ]}
      />,
    );
    expect(screen.getByText(/1 issue/)).toBeInTheDocument();
  });

  it("calls onChange when profileId typed", () => {
    onChange.mockClear();
    render(
      <OpenProfileForm
        value={{ profileId: "", automation: "" }}
        onChange={onChange}
        profiles={[]}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("{{PROFILE_ID}} or profile name"),
      {
        target: { value: "my-prof" },
      },
    );
    expect(onChange).toHaveBeenCalledWith({
      profileId: "my-prof",
      automation: "",
    });
  });
});
