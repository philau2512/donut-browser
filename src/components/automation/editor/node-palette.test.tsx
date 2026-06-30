import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_NODE_BY_TYPE } from "@/lib/automation/node-catalog";
import { NodePalette } from "./node-palette";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "automation.nodes.openUrl.label": "Open URL",
        "automation.nodes.openUrl.description":
          "Navigate the browser to a URL.",
        "automation.nodes.click.label": "Click",
        "automation.nodes.click.description": "Click an element by selector.",
        "automation.editor.groups.navigator": "NAVIGATOR",
        "automation.editor.groups.interaction": "INTERACTION",
        "automation.editor.groups.utility": "UTILITY",
      })[key] ?? key,
  }),
}));

describe("NodePalette", () => {
  it("filters nodes by translated label, description, and raw type", () => {
    render(<NodePalette onDragStart={vi.fn()} />);

    fireEvent.change(
      screen.getByPlaceholderText("automation.editor.searchNodes"),
      {
        target: { value: "browser" },
      },
    );
    expect(screen.getByText("Open URL")).toBeInTheDocument();
    expect(screen.queryByText("Click")).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("automation.editor.searchNodes"),
      {
        target: { value: "click" },
      },
    );
    expect(screen.getByText("Click")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("automation.editor.searchNodes"),
      {
        target: { value: "openurl" },
      },
    );
    expect(screen.getByText("Open URL")).toBeInTheDocument();
  });

  it("delegates drag start with the exact catalog item", () => {
    const onDragStart = vi.fn();
    render(<NodePalette onDragStart={onDragStart} />);

    fireEvent.dragStart(screen.getByRole("button", { name: /Open URL/i }));

    expect(onDragStart).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dragstart" }),
      AUTOMATION_NODE_BY_TYPE.openUrl,
    );
  });
});
