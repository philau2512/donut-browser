"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CookiesTabProps {
  rawCookies: string;
  setRawCookies: (val: string) => void;
}

export function CookiesTab({ rawCookies, setRawCookies }: CookiesTabProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="raw-cookies-input" className="text-base font-bold">
          Import Cookies
        </Label>
        <p className="text-xs text-muted-foreground">
          Paste your cookies here in JSON format (array of cookies) or Netscape
          HTTP Cookie File format.
        </p>
      </div>
      <Textarea
        id="raw-cookies-input"
        value={rawCookies}
        onChange={(e) => setRawCookies(e.target.value)}
        placeholder='e.g. [{"domain": ".google.com", "name": "SID", "value": "..."}]'
        className="font-mono text-xs min-h-[300px] bg-muted/10"
      />
    </div>
  );
}
