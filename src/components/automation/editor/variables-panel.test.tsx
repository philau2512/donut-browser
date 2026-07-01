import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariablesPanel } from "./variables-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("VariablesPanel", () => {
  it("shows reserved variables as read-only auto-injected values", () => {
    render(<VariablesPanel variables={{}} onChange={vi.fn()} />);

    expect(screen.getByText("PROFILE_ID")).toBeInTheDocument();
    expect(screen.getByText("PROFILE_NAME")).toBeInTheDocument();
    expect(screen.getAllByText("Auto-injected")).toHaveLength(6);
  });

  it("adds a trimmed variable and clears draft inputs", () => {
    const onChange = vi.fn();
    render(<VariablesPanel variables={{}} onChange={onChange} />);

    fireEvent.click(screen.getByTitle("Add variable"));

    fireEvent.change(screen.getByPlaceholderText("e.g. EMAIL"), {
      target: { value: " EMAIL " },
    });
    fireEvent.change(screen.getByPlaceholderText("value"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith({ EMAIL: "user@example.com" });
    expect(screen.queryByPlaceholderText("e.g. EMAIL")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("value")).not.toBeInTheDocument();
  });

  it("blocks reserved and duplicate variable keys", () => {
    const onChange = vi.fn();
    render(<VariablesPanel variables={{ EMAIL: "old" }} onChange={onChange} />);

    fireEvent.click(screen.getByTitle("Add variable"));

    fireEvent.change(screen.getByPlaceholderText("e.g. EMAIL"), {
      target: { value: " profile_id " },
    });
    expect(
      screen.getByText("automation.editor.variables.reserved"),
    ).toBeInTheDocument();
    const addBtn = screen.getAllByRole("button").at(-1);
    if (!addBtn) throw new Error("add button not found");
    fireEvent.click(addBtn);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("e.g. EMAIL"), {
      target: { value: "EMAIL" },
    });
    const addBtn2 = screen.getAllByRole("button").at(-1);
    if (!addBtn2) throw new Error("add button not found");
    fireEvent.click(addBtn2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("updates and deletes existing variables", () => {
    const onChange = vi.fn();
    render(
      <VariablesPanel
        variables={{ EMAIL: "old", API_KEY: "secret" }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("old"), {
      target: { value: "new" },
    });
    expect(onChange).toHaveBeenCalledWith({ EMAIL: "new", API_KEY: "secret" });

    const deleteButtons = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("text-destructive"));
    fireEvent.click(deleteButtons[0]);
    expect(onChange).toHaveBeenLastCalledWith({ EMAIL: "old" });
  });
});
