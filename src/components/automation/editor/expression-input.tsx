"use client";

import { LuCode } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface ExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  variables: Record<string, string>;
}

const RESERVED_VARIABLES = ["PROFILE_ID", "PROFILE_NAME"];

export function ExpressionInput({
  value,
  onChange,
  placeholder,
  multiline,
  variables,
}: ExpressionInputProps) {
  const names = [...RESERVED_VARIABLES, ...Object.keys(variables).sort()];

  const insertVariable = (name: string) => {
    const suffix = value && !value.endsWith(" ") ? " " : "";
    onChange(`${value}${suffix}{{${name}}}`);
  };

  const fieldProps = {
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    placeholder,
  };

  return (
    <div className="space-y-2">
      {multiline ? <Textarea {...fieldProps} /> : <Input {...fieldProps} />}
      <div className="flex flex-wrap gap-1">
        {names.map((name) => (
          <Button
            key={name}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => insertVariable(name)}
          >
            <LuCode className="mr-1 size-3" />
            {name}
          </Button>
        ))}
      </div>
    </div>
  );
}
