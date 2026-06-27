"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/app-shell";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="group toaster"
      closeButton
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "var(--border)",
          zIndex: 10001,
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          zIndex: 10001,
          pointerEvents: "auto",
          backdropFilter: "saturate(1.2)",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
