import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariablesPanel } from "./variables-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("VariablesPanel", () => {
  it("shows reserved variables as read-only auto-injected values", () => {
    render(<VariablesPanel variables={{}} onChange={vi.fn()} />);

    expect(screen.getByDisplayValue("PROFILE_ID")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PROFILE_NAME")).toBeInTheDocument();
    expect(
      screen.getAllByDisplayValue("automation.editor.variables.autoInjected"),
    ).toHaveLength(2);
  });

  it("adds a trimmed variable and clears draft inputs", () => {
    const onChange = vi.fn();
    render(<VariablesPanel variables={{}} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("EMAIL"), {
      target: { value: " EMAIL " },
    });
    fireEvent.change(screen.getByPlaceholderText("value"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button"));

    expect(onChange).toHaveBeenCalledWith({ EMAIL: "user@example.com" });
    expect(screen.getByPlaceholderText("EMAIL")).toHaveValue("");
    expect(screen.getByPlaceholderText("value")).toHaveValue("");
  });

  it("blocks reserved and duplicate variable keys", () => {
    const onChange = vi.fn();
    render(<VariablesPanel variables={{ EMAIL: "old" }} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("EMAIL"), {
      target: { value: " profile_id " },
    });
    expect(
      screen.getByText("automation.editor.variables.reserved"),
    ).toBeInTheDocument();
    const addBtn = screen.getAllByRole("button").at(-1);
    if (!addBtn) throw new Error("add button not found");
    fireEvent.click(addBtn);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("EMAIL"), {
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
