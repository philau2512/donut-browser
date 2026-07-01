import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectorInput } from "./selector-input";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("./expression-input", () => ({
  ExpressionInput: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="expression-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

describe("SelectorInput", () => {
  it("parses CSS selector by default", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput value=".btn-primary" onChange={onChange} variables={{}} />,
    );

    const cssRadio = screen.getByLabelText("CSS") as HTMLInputElement;
    expect(cssRadio).toHaveAttribute("aria-checked", "true");

    const input = screen.getByPlaceholderText(
      ".btn-primary",
    ) as HTMLInputElement;
    expect(input.value).toBe(".btn-primary");
  });

  it("parses XPath selector automatically", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput
        value="//button[@id='submit']"
        onChange={onChange}
        variables={{}}
      />,
    );

    const xpathRadio = screen.getByLabelText("XPath") as HTMLInputElement;
    expect(xpathRadio).toHaveAttribute("aria-checked", "true");

    const input = screen.getByDisplayValue(
      "//button[@id='submit']",
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("parses XPath prefixed with xpath= selector", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput value="xpath=div" onChange={onChange} variables={{}} />,
    );

    const xpathRadio = screen.getByLabelText("XPath") as HTMLInputElement;
    expect(xpathRadio).toHaveAttribute("aria-checked", "true");

    const input = screen.getByDisplayValue("div") as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("parses Text exact match selector", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput value='text="Login"' onChange={onChange} variables={{}} />,
    );

    const textRadio = screen.getByLabelText("Text") as HTMLInputElement;
    expect(textRadio).toHaveAttribute("aria-checked", "true");

    const matchSelect = screen.getByRole("combobox") as HTMLButtonElement;
    expect(matchSelect.textContent).toBe("Exact match");

    const input = screen.getByDisplayValue("Login") as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("parses Text start-with selector", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput
        value="text=/^hello/i"
        onChange={onChange}
        variables={{}}
      />,
    );

    const matchSelect = screen.getByRole("combobox") as HTMLButtonElement;
    expect(matchSelect.textContent).toBe("Start with");

    const input = screen.getByDisplayValue("hello") as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("parses Text end-with selector", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput
        value="text=/world$/i"
        onChange={onChange}
        variables={{}}
      />,
    );

    const matchSelect = screen.getByRole("combobox") as HTMLButtonElement;
    expect(matchSelect.textContent).toBe("End with");

    const input = screen.getByDisplayValue("world") as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("renders ExpressionInput when supportsExpression is true", () => {
    const onChange = vi.fn();
    render(
      <SelectorInput
        value=".btn"
        onChange={onChange}
        variables={{}}
        supportsExpression
      />,
    );

    const expInput = screen.getByTestId("expression-input") as HTMLInputElement;
    expect(expInput).toBeInTheDocument();
    expect(expInput.value).toBe(".btn");

    fireEvent.change(expInput, { target: { value: ".btn-new" } });
    expect(onChange).toHaveBeenCalledWith(".btn-new");
  });

  it("builds correct selector string when switching types", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectorInput value=".btn" onChange={onChange} variables={{}} />,
    );

    // Switch to XPath
    fireEvent.click(screen.getByLabelText("XPath"));
    expect(onChange).toHaveBeenCalledWith("xpath=.btn");

    // Switch to Text
    rerender(
      <SelectorInput value="xpath=.btn" onChange={onChange} variables={{}} />,
    );
    fireEvent.click(screen.getByLabelText("Text"));
    expect(onChange).toHaveBeenCalledWith("text=.btn");
  });
});
