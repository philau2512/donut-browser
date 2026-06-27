import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AutomationNodeCatalogItem } from "@/lib/automation/node-catalog";
import { PropertyForm } from "./property-form";
import type { AutomationCanvasNode } from "./serialize";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      aria-label="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      type="checkbox"
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="select"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

const catalog: AutomationNodeCatalogItem = {
  type: "click",
  group: "interaction",
  labelKey: "click",
  descriptionKey: "click.desc",
  documentKey: "click.doc",
  icon: () => null,
  defaults: {},
  params: [
    {
      key: "selector",
      kind: "string",
      required: true,
      supportsExpression: true,
      labelKey: "selector.label",
      helpKey: "selector.help",
    },
    { key: "timeout", kind: "number", labelKey: "timeout.label" },
    { key: "enabled", kind: "boolean", labelKey: "enabled.label" },
    {
      key: "button",
      kind: "enum",
      labelKey: "button.label",
      options: [{ value: "left" }, { value: "right" }],
    },
  ],
};

const node = {
  id: "n1",
  type: "automation",
  position: { x: 0, y: 0 },
  data: {
    label: "click",
    nodeType: "click",
    params: { selector: "#go", timeout: 1000, enabled: false, button: "left" },
  },
} as AutomationCanvasNode;

describe("PropertyForm", () => {
  it("renders controls by param spec and forwards changes", () => {
    const onParamChange = vi.fn();
    render(
      <PropertyForm
        catalog={catalog}
        node={node}
        variables={{ EMAIL: "user@example.com" }}
        onParamChange={onParamChange}
      />,
    );

    expect(screen.getByText("selector.label")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText("selector.help")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("#go"), {
      target: { value: "#next" },
    });
    expect(onParamChange).toHaveBeenCalledWith("selector", "#next");

    fireEvent.change(screen.getByDisplayValue("1000"), {
      target: { value: "2500" },
    });
    expect(onParamChange).toHaveBeenCalledWith("timeout", 2500);

    fireEvent.click(screen.getByLabelText("checkbox"));
    expect(onParamChange).toHaveBeenCalledWith("enabled", true);

    fireEvent.change(screen.getByLabelText("select"), {
      target: { value: "right" },
    });
    expect(onParamChange).toHaveBeenCalledWith("button", "right");
  });

  it("keeps current number-field behavior where an empty value becomes 0", () => {
    const onParamChange = vi.fn();
    render(
      <PropertyForm
        catalog={catalog}
        node={node}
        variables={{}}
        onParamChange={onParamChange}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("1000"), {
      target: { value: "" },
    });

    expect(onParamChange).toHaveBeenCalledWith("timeout", 0);
  });
});
