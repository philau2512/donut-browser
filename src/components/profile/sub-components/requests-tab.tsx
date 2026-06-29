"use client";

import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RequestsTabProps {
  dnsBlocklist: string;
  setDnsBlocklist: (val: string) => void;
}

export function RequestsTab({
  dnsBlocklist,
  setDnsBlocklist,
}: RequestsTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-1 pb-2">
        <h3 className="text-base font-bold">Requests & Blocking</h3>
        <p className="text-xs text-muted-foreground">
          Block tracking, ads, and malicious domains at the DNS level.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dns-blocklist-sel">{t("dnsBlocklist.title")}</Label>
        <Select
          value={dnsBlocklist || "none"}
          onValueChange={(val) => {
            setDnsBlocklist(val === "none" ? "" : val);
          }}
        >
          <SelectTrigger id="dns-blocklist-sel" className="h-9">
            <SelectValue placeholder={t("dnsBlocklist.none")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("dnsBlocklist.none")}</SelectItem>
            <SelectItem value="light">{t("dnsBlocklist.light")}</SelectItem>
            <SelectItem value="normal">{t("dnsBlocklist.normal")}</SelectItem>
            <SelectItem value="pro">{t("dnsBlocklist.pro")}</SelectItem>
            <SelectItem value="pro_plus">
              {t("dnsBlocklist.proPlus")}
            </SelectItem>
            <SelectItem value="ultimate">
              {t("dnsBlocklist.ultimate")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
