import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { VariableSelectInput } from "./variable-select-input";

describe("VariableSelectInput", () => {
  it("renders input value and placeholder correctly", () => {
    const onChange = vi.fn();
    render(
      <VariableSelectInput
        value="MY_VAR"
        onChange={onChange}
        variables={{}}
        placeholder="Enter variable name"
      />,
    );

    const input = screen.getByPlaceholderText(
      "Enter variable name",
    ) as HTMLInputElement;
    expect(input.value).toBe("MY_VAR");
  });

  it("trims and capitalizes typed input value", () => {
    const onChange = vi.fn();
    render(
      <VariableSelectInput
        value=""
        onChange={onChange}
        variables={{}}
        placeholder="Var name"
      />,
    );

    const input = screen.getByPlaceholderText("Var name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   new_var   " } });
    expect(onChange).toHaveBeenCalledWith("NEW_VAR");
  });

  it("lists, filters, and selects variables from Popover", () => {
    const onChange = vi.fn();
    const TestWrapper = () => {
      const [val, setVal] = useState("");
      return (
        <VariableSelectInput
          value={val}
          onChange={(v) => {
            setVal(v);
            onChange(v);
          }}
          variables={{
            VAR_A: "1",
            VAR_B: "2",
            OTHER_VAR: "3",
          }}
          placeholder="Var name"
        />
      );
    };

    render(<TestWrapper />);

    // Open Popover by clicking input
    const input = screen.getByPlaceholderText("Var name");
    fireEvent.click(input);

    // Check all user variables are rendered
    expect(screen.getByRole("button", { name: "VAR_A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VAR_B" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "OTHER_VAR" }),
    ).toBeInTheDocument();

    // Use main input to search
    fireEvent.change(input, { target: { value: "OTHER" } });

    // VAR_A and VAR_B should not be visible or found easily (in test query)
    expect(
      screen.queryByRole("button", { name: "VAR_A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "VAR_B" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "OTHER_VAR" }),
    ).toBeInTheDocument();

    // Click OTHER_VAR to select
    fireEvent.click(screen.getByRole("button", { name: "OTHER_VAR" }));
    expect(onChange).toHaveBeenCalledWith("OTHER_VAR");

    // Popover should close
    expect(
      screen.queryByRole("button", { name: "OTHER_VAR" }),
    ).not.toBeInTheDocument();
  });

  it("shows '+ Create' button when typing a new variable name and calls callbacks on click", () => {
    const onChange = vi.fn();
    const onCreateVariable = vi.fn();

    const TestWrapper = () => {
      const [val, setVal] = useState("");
      return (
        <VariableSelectInput
          value={val}
          onChange={(v) => {
            setVal(v);
            onChange(v);
          }}
          variables={{
            EXISTING_VAR: "1",
          }}
          onCreateVariable={onCreateVariable}
          placeholder="Var name"
        />
      );
    };

    render(<TestWrapper />);

    const input = screen.getByPlaceholderText("Var name");
    fireEvent.click(input);

    // Type a new variable name
    fireEvent.change(input, { target: { value: "NEW_COOL_VAR" } });

    // The "+ Create" button should appear
    const createBtn = screen.getByRole("button", {
      name: "+ Create NEW_COOL_VAR",
    });
    expect(createBtn).toBeInTheDocument();

    // Click "+ Create"
    fireEvent.click(createBtn);

    expect(onCreateVariable).toHaveBeenCalledWith("NEW_COOL_VAR");
    expect(onChange).toHaveBeenCalledWith("NEW_COOL_VAR");

    // Popover should close
    expect(createBtn).not.toBeInTheDocument();
  });
});
