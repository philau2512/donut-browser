import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";

describe("accordion/switch smoke", () => {
  it("renders accordion", () => {
    render(
      <Accordion type="multiple" defaultValue={["a"]}>
        <AccordionItem value="a">
          <AccordionTrigger>Title</AccordionTrigger>
          <AccordionContent>Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
  }, 8000);

  it("renders switch", () => {
    render(<Switch checked onCheckedChange={() => undefined} />);
    expect(document.querySelector("button")).toBeTruthy();
  }, 8000);
});
