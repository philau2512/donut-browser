"use client";

import Color from "color";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from "@/components/ui/color-picker";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getThemeByColors,
  getThemeById,
  THEME_VARIABLES,
  THEMES,
} from "@/lib/themes";

interface CustomThemeState {
  selectedThemeId: string | null;
  colors: Record<string, string>;
}

interface ThemeSettingsProps {
  theme: string;
  onThemeChange: (value: string) => void;
  customThemeState: CustomThemeState;
  setCustomThemeState: React.Dispatch<React.SetStateAction<CustomThemeState>>;
}

export function ThemeSettings({
  theme,
  onThemeChange,
  customThemeState,
  setCustomThemeState,
}: ThemeSettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        {t("settings.appearance.title")}
      </Label>

      <div className="grid gap-2">
        <Label htmlFor="theme-select" className="text-sm">
          {t("settings.appearance.theme")}
        </Label>
        <Select
          value={theme}
          onValueChange={(value) => {
            onThemeChange(value);
            if (value === "custom") {
              const tokyoNightTheme = getThemeById("tokyo-night");
              if (tokyoNightTheme) {
                setCustomThemeState({
                  selectedThemeId: "tokyo-night",
                  colors: tokyoNightTheme.colors,
                });
              }
            }
          }}
        >
          <SelectTrigger id="theme-select">
            <SelectValue placeholder={t("settings.appearance.selectTheme")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">
              {t("settings.appearance.light")}
            </SelectItem>
            <SelectItem value="dark">
              {t("settings.appearance.dark")}
            </SelectItem>
            <SelectItem value="system">
              {t("settings.appearance.system")}
            </SelectItem>
            <SelectItem value="custom">{t("common.labels.custom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("settings.appearance.themeDescription")}
      </p>

      {theme === "custom" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label
              htmlFor="theme-preset-select"
              className="text-sm font-medium"
            >
              {t("settings.appearance.themePreset")}
            </Label>
            <Select
              value={customThemeState.selectedThemeId ?? "custom"}
              onValueChange={(value) => {
                if (value === "custom") {
                  setCustomThemeState((prev) => ({
                    ...prev,
                    selectedThemeId: null,
                  }));
                } else {
                  const themePreset = getThemeById(value);
                  if (themePreset) {
                    setCustomThemeState({
                      selectedThemeId: value,
                      colors: themePreset.colors,
                    });
                  }
                }
              }}
            >
              <SelectTrigger id="theme-preset-select">
                <SelectValue
                  placeholder={t("settings.appearance.selectThemePreset")}
                />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((themePreset) => (
                  <SelectItem key={themePreset.id} value={themePreset.id}>
                    {themePreset.name}
                  </SelectItem>
                ))}
                <SelectItem value="custom">
                  {t("settings.appearance.yourOwn")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm font-medium">
            {t("settings.appearance.customColors")}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-3">
            {THEME_VARIABLES.map(({ key, label }) => {
              const colorValue = customThemeState.colors[key] ?? "#000000";
              return (
                <div key={key} className="flex flex-col items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={label}
                        className="size-8 cursor-pointer rounded-md border shadow-sm"
                        style={{ backgroundColor: colorValue }}
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-3" sideOffset={6}>
                      <ColorPicker
                        className="rounded-md border bg-background p-3 shadow-sm"
                        value={colorValue}
                        onColorChange={([r, g, b, a]) => {
                          const next = Color({ r, g, b }).alpha(a);
                          const nextStr = next.hexa();
                          const newColors = {
                            ...customThemeState.colors,
                            [key]: nextStr,
                          };

                          const matchingTheme = getThemeByColors(newColors);

                          setCustomThemeState({
                            selectedThemeId: matchingTheme?.id ?? null,
                            colors: newColors,
                          });
                        }}
                      >
                        <ColorPickerSelection className="h-36 rounded" />
                        <div className="mt-3 flex items-center gap-3">
                          <ColorPickerEyeDropper />
                          <div className="grid w-full gap-1">
                            <ColorPickerHue />
                            <ColorPickerAlpha />
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <ColorPickerOutput />
                          <ColorPickerFormat />
                        </div>
                      </ColorPicker>
                    </PopoverContent>
                  </Popover>
                  <div className="text-center text-[10px] leading-tight text-muted-foreground">
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
