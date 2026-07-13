"use client";

import { useMemo, useRef, useState } from "react";
import { LuCode, LuVariable } from "react-icons/lu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { isReservedFlowVariable } from "@/lib/automation/flow-variables";

interface VariableSelectInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: Record<string, string>;
  placeholder?: string;
  onCreateVariable?: (name: string) => void;
}

export function VariableSelectInput({
  value,
  onChange,
  variables,
  placeholder,
  onCreateVariable,
}: VariableSelectInputProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const userVars = useMemo(() => {
    return Object.keys(variables)
      .filter((name) => !isReservedFlowVariable(name))
      .sort();
  }, [variables]);

  const filteredVars = useMemo(() => {
    const s = value.trim().toLowerCase();
    if (!s) return userVars;
    return userVars.filter((name) => name.toLowerCase().includes(s));
  }, [userVars, value]);

  const showCreateOption = useMemo(() => {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return false;
    return !userVars.includes(trimmed);
  }, [userVars, value]);

  const selectVariable = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative w-full">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value.trim().toUpperCase());
              if (!open) setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="pr-8 uppercase"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-muted-foreground pointer-events-none">
            <LuCode className="size-4" />
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1 flex flex-col pointer-events-auto"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target === inputRef.current) {
            e.preventDefault();
          }
        }}
      >
        <div className="max-h-48 overflow-y-auto pr-0.5 space-y-0.5">
          {showCreateOption && (
            <button
              type="button"
              onClick={() => {
                const trimmed = value.trim().toUpperCase();
                onCreateVariable?.(trimmed);
                selectVariable(trimmed);
              }}
              className="w-full text-left font-mono text-[11px] px-2 py-1.5 rounded text-primary hover:bg-accent flex items-center gap-1.5 transition border border-dashed border-primary/20 bg-primary/5 hover:border-primary/40"
            >
              + Create {value.trim().toUpperCase()}
            </button>
          )}
          {filteredVars.length === 0 && !showCreateOption ? (
            <div className="text-[10px] text-muted-foreground text-center py-2">
              No existing variables found
            </div>
          ) : (
            filteredVars.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => selectVariable(name)}
                className="w-full text-left font-mono text-[11px] px-2 py-1.5 rounded hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 transition"
              >
                <LuVariable className="size-3 text-muted-foreground" />
                {name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
