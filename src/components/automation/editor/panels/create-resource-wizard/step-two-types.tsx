"use client";

import { useCreateResourceWizard } from "./wizard-context";

const RESOURCE_TYPES = [
  {
    id: "FixedString",
    label: "FixedString",
    badge: "abc",
    desc: "User sets constant string value.",
  },
  {
    id: "FixedInteger",
    label: "FixedInteger",
    badge: "123",
    desc: "User sets constant integer value.",
  },
  {
    id: "RandomString",
    label: "RandomString",
    badge: "a-Z",
    desc: "Generates random string.",
  },
  {
    id: "RandomInteger",
    label: "RandomInteger",
    badge: "0-9",
    desc: "Generates random integer.",
  },
  {
    id: "Select",
    label: "Select",
    badge: "list",
    desc: "Select item from predefined options.",
  },
  {
    id: "LinesFromFile",
    label: "LinesFromFile",
    badge: ".txt",
    desc: "Reads lines from a local file.",
  },
  {
    id: "LinesFromUrl",
    label: "LinesFromUrl",
    badge: "@",
    desc: "Reads lines from a URL.",
  },
  {
    id: "FilesFromDirectory",
    label: "FilesFromDirectory",
    badge: "c:/",
    desc: "Reads files from a directory.",
  },
  {
    id: "Database",
    label: "Database",
    badge: "db",
    desc: "Reads from database.",
  },
  {
    id: "Checkbox",
    label: "Checkbox",
    badge: "check",
    desc: "True/false checkbox.",
  },
  {
    id: "Information",
    label: "Information",
    badge: "?",
    desc: "Displays information.",
  },
];

export function StepTwoTypes() {
  const { wizardType, setWizardType } = useCreateResourceWizard();

  return (
    <div className="grid grid-cols-2 gap-2">
      {RESOURCE_TYPES.map((tItem) => {
        const isSelected = wizardType === tItem.id;
        return (
          <button
            key={tItem.id}
            type="button"
            onClick={() => setWizardType(tItem.id)}
            className={`flex items-start gap-3 p-3 rounded border text-left transition select-none ${
              isSelected
                ? "border-purple-500 bg-purple-950/20"
                : "border-zinc-800 bg-zinc-950/40 hover:bg-zinc-800/40 hover:border-zinc-700"
            }`}
          >
            <span className="flex items-center justify-center shrink-0 w-8 h-5 bg-zinc-800 text-zinc-300 rounded border border-zinc-700 font-mono text-[9px] font-bold">
              {tItem.badge}
            </span>
            <div className="min-w-0">
              <p
                className={`text-xs font-semibold ${isSelected ? "text-purple-300" : "text-zinc-200"}`}
              >
                {tItem.label}
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                {tItem.desc}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
