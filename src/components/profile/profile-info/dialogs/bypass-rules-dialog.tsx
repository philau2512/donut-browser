"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LuPlus, LuX } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ProfileBypassRulesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string | null;
  initialRules?: string[];
}

export function ProfileBypassRulesDialog({
  isOpen,
  onClose,
  profileId,
  initialRules,
}: ProfileBypassRulesDialogProps) {
  const { t } = useTranslation();
  const [bypassRules, setBypassRules] = React.useState<string[]>([]);
  const [newRule, setNewRule] = React.useState("");

  React.useEffect(() => {
    if (isOpen) {
      setBypassRules(initialRules ?? []);
      setNewRule("");
    }
  }, [isOpen, initialRules]);

  const updateBypassRules = async (rules: string[]) => {
    if (!profileId) return;
    try {
      await invoke("update_profile_proxy_bypass_rules", {
        profileId,
        rules,
      });
      setBypassRules(rules);
    } catch {
      // ignore
    }
  };

  const handleAddRule = () => {
    const trimmed = newRule.trim();
    if (!trimmed || bypassRules.includes(trimmed)) return;
    const updated = [...bypassRules, trimmed];
    setNewRule("");
    void updateBypassRules(updated);
  };

  const handleRemoveRule = (rule: string) => {
    void updateBypassRules(bypassRules.filter((r) => r !== rule));
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("profileInfo.network.bypassRulesTitle")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("profileInfo.network.bypassRulesDescription")}
            </p>
            <div className="flex gap-2">
              <Input
                value={newRule}
                onChange={(e) => {
                  setNewRule(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddRule();
                }}
                placeholder={t("profileInfo.network.rulePlaceholder")}
                className="flex-1 text-sm"
              />
              <Button
                size="sm"
                onClick={handleAddRule}
                disabled={!newRule.trim()}
              >
                <LuPlus className="mr-1 size-4" />
                {t("profileInfo.network.addRule")}
              </Button>
            </div>
            {bypassRules.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {t("profileInfo.network.noRules")}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {bypassRules.map((rule) => (
                  <div
                    key={rule}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm"
                  >
                    <span className="truncate font-mono text-xs">{rule}</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleRemoveRule(rule);
                      }}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <LuX className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("profileInfo.network.ruleTypes")}
            </p>
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            {t("common.buttons.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
