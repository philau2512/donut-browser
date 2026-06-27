"use client";

import { useMemo, useState } from "react";
import { LuCode, LuSearch } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const names = useMemo(() => {
    return [...RESERVED_VARIABLES, ...Object.keys(variables).sort()];
  }, [variables]);

  const filteredNames = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return names;
    return names.filter((name) => name.toLowerCase().includes(s));
  }, [names, search]);

  const insertVariable = (name: string) => {
    const suffix = value && !value.endsWith(" ") ? " " : "";
    onChange(`${value}${suffix}{{${name}}}`);
    setOpen(false);
  };

  const fieldProps = {
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    placeholder,
  };

  return (
    <div className="flex gap-2 items-start w-full">
      <div className="flex-1 min-w-0">
        {multiline ? (
          <Textarea {...fieldProps} className="min-h-[80px]" />
        ) : (
          <Input {...fieldProps} />
        )}
      </div>
      <Popover
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary h-9 w-9 shrink-0 p-0 flex items-center justify-center rounded-md"
            title="Insert Variable"
          >
            <LuCode className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-56 p-2 flex flex-col gap-1.5 pointer-events-auto"
        >
          <div className="relative shrink-0">
            <LuSearch className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search variables..."
              className="pl-7 h-7 text-xs"
            />
          </div>
          <div className="max-h-48 overflow-y-auto pr-0.5 space-y-0.5">
            {filteredNames.length === 0 ? (
              <div className="text-[10px] text-muted-foreground text-center py-2">
                No variables found
              </div>
            ) : (
              filteredNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertVariable(name)}
                  className="w-full text-left font-mono text-[11px] px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 transition"
                >
                  <LuCode className="size-3 text-muted-foreground" />
                  {name}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
