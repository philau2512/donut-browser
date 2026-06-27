import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExpressionInput } from "./expression-input";

describe("ExpressionInput", () => {
  it("renders reserved variables before sorted user variables", () => {
    render(
      <ExpressionInput
        value=""
        onChange={vi.fn()}
        variables={{ ZED: "z", EMAIL: "e" }}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["PROFILE_ID", "PROFILE_NAME", "EMAIL", "ZED"]);
  });

  it("inserts variable expressions with safe spacing", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ExpressionInput
        value=""
        onChange={onChange}
        variables={{ EMAIL: "e" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /EMAIL/i }));
    expect(onChange).toHaveBeenLastCalledWith("{{EMAIL}}");

    rerender(
      <ExpressionInput
        value="hello"
        onChange={onChange}
        variables={{ EMAIL: "e" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /EMAIL/i }));
    expect(onChange).toHaveBeenLastCalledWith("hello {{EMAIL}}");

    rerender(
      <ExpressionInput
        value="hello "
        onChange={onChange}
        variables={{ EMAIL: "e" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /EMAIL/i }));
    expect(onChange).toHaveBeenLastCalledWith("hello {{EMAIL}}");
  });

  it("uses a textarea when multiline is enabled", () => {
    const onChange = vi.fn();
    render(
      <ExpressionInput
        value="line 1"
        onChange={onChange}
        multiline
        placeholder="message"
        variables={{}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("message"), {
      target: { value: "line 2" },
    });

    expect(screen.getByPlaceholderText("message").tagName).toBe("TEXTAREA");
    expect(onChange).toHaveBeenCalledWith("line 2");
  });
});
