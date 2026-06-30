import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AutomationNodeConfig } from "@/types";

interface AutomationNodeCardProps {
  node: AutomationNodeConfig & { id: string; enabled: boolean };
  index: number;
  total: number;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleEnabled: () => void;
  hasOrderingIssue?: boolean;
  orderingWarning?: string;
}

export function AutomationNodeCard({
  node,
  index,
  total,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  hasOrderingIssue,
  orderingWarning,
}: AutomationNodeCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getNodeTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      dynamic_proxy: t("automation.nodeTypes.dynamicProxy"),
      ip_check: t("automation.nodeTypes.ipCheck"),
      local_command: t("automation.nodeTypes.localCommand"),
      webhook: t("automation.nodeTypes.webhook"),
      telegram_alert: t("automation.nodeTypes.telegramAlert"),
      cleanup: t("automation.nodeTypes.cleanup"),
    };
    return labels[type] || type;
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-3">
      <Card className={!node.enabled ? "opacity-60" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{getNodeTypeLabel(node.type)}</Badge>
                {hasOrderingIssue && (
                  <Badge variant="outline" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t("automation.dependencyWarning")}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{node.label}</p>
            </div>

            <div className="flex items-center gap-1">
              <Switch
                checked={node.enabled}
                onCheckedChange={onToggleEnabled}
              />

              <Button
                variant="ghost"
                size="icon"
                onClick={onMoveUp}
                disabled={index === 0}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={onMoveDown}
                disabled={index === total - 1}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>

              <Button variant="ghost" size="icon" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>

              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            </div>
          </div>
        </CardHeader>

        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {hasOrderingIssue && orderingWarning && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{orderingWarning}</AlertDescription>
                </Alert>
              )}

              {node.type === "dynamic_proxy" && (
                <DynamicProxyForm node={node} onUpdate={onUpdate} />
              )}
              {node.type === "ip_check" && (
                <IpCheckForm node={node} onUpdate={onUpdate} />
              )}
              {node.type === "local_command" && (
                <LocalCommandForm node={node} onUpdate={onUpdate} />
              )}
              {node.type === "webhook" && (
                <WebhookForm node={node} onUpdate={onUpdate} />
              )}
              {node.type === "telegram_alert" && (
                <TelegramAlertForm node={node} onUpdate={onUpdate} />
              )}
              {node.type === "cleanup" && (
                <CleanupForm node={node} onUpdate={onUpdate} />
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}

// DynamicProxyNode form
function DynamicProxyForm({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNodeConfig, { type: "dynamic_proxy" }>;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <Label>{t("automation.fields.label")}</Label>
        <Input
          value={node.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={t("automation.fields.labelPlaceholder")}
        />
      </div>

      <div>
        <Label>{t("automation.fields.apiUrl")}</Label>
        <Input
          value={node.api_url}
          onChange={(e) => onUpdate({ api_url: e.target.value })}
          placeholder="https://api.example.com/proxy"
        />
      </div>

      <div>
        <Label>{t("automation.fields.protocol")}</Label>
        <Select
          value={node.protocol}
          onValueChange={(value) =>
            onUpdate({ protocol: value as "http" | "https" | "socks5" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="https">HTTPS</SelectItem>
            <SelectItem value="socks5">SOCKS5</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>{t("automation.fields.responseFormat")}</Label>
        <Select
          value={node.response_format}
          onValueChange={(value) =>
            onUpdate({ response_format: value as "json" | "text" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="text">Text (ip:port)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {node.response_format === "json" && (
        <>
          <div>
            <Label>{t("automation.fields.jsonPathIp")}</Label>
            <Input
              value={node.json_path_ip || ""}
              onChange={(e) => onUpdate({ json_path_ip: e.target.value })}
              placeholder="data.proxy.host"
            />
          </div>
          <div>
            <Label>{t("automation.fields.jsonPathPort")}</Label>
            <Input
              value={node.json_path_port || ""}
              onChange={(e) => onUpdate({ json_path_port: e.target.value })}
              placeholder="data.proxy.port"
            />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("automation.fields.timeout")}</Label>
          <Input
            type="number"
            value={node.timeout_seconds}
            onChange={(e) =>
              onUpdate({ timeout_seconds: Number.parseInt(e.target.value, 10) })
            }
            min={1}
            max={300}
          />
        </div>
        <div>
          <Label>{t("automation.fields.maxAttempts")}</Label>
          <Input
            type="number"
            value={node.max_attempts}
            onChange={(e) =>
              onUpdate({ max_attempts: Number.parseInt(e.target.value, 10) })
            }
            min={1}
            max={10}
          />
        </div>
      </div>
    </div>
  );
}

// IpCheckNode form
function IpCheckForm({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNodeConfig, { type: "ip_check" }>;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <Label>{t("automation.fields.label")}</Label>
        <Input
          value={node.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <Label>{t("automation.fields.allowedCountries")}</Label>
        <Input
          value={node.allowed_countries.join(", ")}
          onChange={(e) =>
            onUpdate({
              allowed_countries: e.target.value
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean),
            })
          }
          placeholder="US, GB, CA"
        />
      </div>

      <div>
        <Label>{t("automation.fields.maxFraudScore")}</Label>
        <Input
          type="number"
          value={node.max_fraud_score}
          onChange={(e) =>
            onUpdate({ max_fraud_score: Number.parseInt(e.target.value, 10) })
          }
          min={0}
          max={100}
        />
      </div>
    </div>
  );
}

// LocalCommandNode form
function LocalCommandForm({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNodeConfig, { type: "local_command" }>;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t("automation.securityWarning.title")}</AlertTitle>
        <AlertDescription>
          {t("automation.securityWarning.localCommand")}
        </AlertDescription>
      </Alert>

      <div>
        <Label>{t("automation.fields.label")}</Label>
        <Input
          value={node.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <Label>{t("automation.fields.command")}</Label>
        <Textarea
          value={node.command}
          onChange={(e) => onUpdate({ command: e.target.value })}
          placeholder="echo {{profile_name}}"
          rows={3}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t("automation.fields.variablesAvailable")}:{" "}
          {`{{profile_id}}, {{profile_name}}, {{proxy_ip}}`}
        </p>
      </div>

      <div>
        <Label>{t("automation.fields.timeoutSeconds")}</Label>
        <Input
          type="number"
          value={node.timeout_seconds}
          onChange={(e) =>
            onUpdate({ timeout_seconds: Number.parseInt(e.target.value, 10) })
          }
          min={1}
          max={3600}
        />
      </div>
    </div>
  );
}

// WebhookNode form
function WebhookForm({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNodeConfig, { type: "webhook" }>;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <Label>{t("automation.fields.label")}</Label>
        <Input
          value={node.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <Label>{t("automation.fields.webhookUrl")}</Label>
        <Input
          value={node.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://api.example.com/webhook?profile={{profile_id}}"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t("automation.fields.variablesAvailable")}:{" "}
          {`{{profile_id}}, {{profile_name}}, {{proxy_ip}}`}
        </p>
      </div>

      <div>
        <Label>{t("automation.fields.method")}</Label>
        <Select
          value={node.method}
          onValueChange={(value) =>
            onUpdate({ method: value as "GET" | "POST" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {node.method === "POST" && (
        <div>
          <Label>{t("automation.fields.requestBody")}</Label>
          <Textarea
            value={node.body || ""}
            onChange={(e) => onUpdate({ body: e.target.value })}
            placeholder='{"profile": "{{profile_name}}", "ip": "{{proxy_ip}}"}'
            rows={4}
          />
        </div>
      )}

      <div>
        <Label>{t("automation.fields.timeout")}</Label>
        <Input
          type="number"
          value={node.timeout_seconds}
          onChange={(e) =>
            onUpdate({ timeout_seconds: Number.parseInt(e.target.value, 10) })
          }
          min={1}
          max={300}
        />
      </div>
    </div>
  );
}

// TelegramAlertNode form
function TelegramAlertForm({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNodeConfig, { type: "telegram_alert" }>;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <Label>{t("automation.fields.label")}</Label>
        <Input
          value={node.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <Label>{t("automation.fields.botToken")}</Label>
        <Input
          type="password"
          value={node.bot_token}
          onChange={(e) => onUpdate({ bot_token: e.target.value })}
          placeholder="123456:ABC-DEF..."
        />
      </div>

      <div>
        <Label>{t("automation.fields.chatId")}</Label>
        <Input
          value={node.chat_id}
          onChange={(e) => onUpdate({ chat_id: e.target.value })}
          placeholder="-1001234567890"
        />
      </div>

      <div>
        <Label>{t("automation.fields.message")}</Label>
        <Textarea
          value={node.message}
          onChange={(e) => onUpdate({ message: e.target.value })}
          placeholder="Profile {{profile_name}} started with IP {{proxy_ip}}"
          rows={3}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t("automation.fields.variablesAvailable")}:{" "}
          {`{{profile_id}}, {{profile_name}}, {{proxy_ip}}, {{ip_country}}`}
        </p>
      </div>
    </div>
  );
}

// CleanupNode form
function CleanupForm({
  node,
  onUpdate,
}: {
  node: Extract<AutomationNodeConfig, { type: "cleanup" }>;
  onUpdate: (updates: Partial<AutomationNodeConfig>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <Label>{t("automation.fields.label")}</Label>
        <Input
          value={node.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <Label>{t("automation.fields.cleanupMode")}</Label>
        <Select
          value={node.mode}
          onValueChange={(value) =>
            onUpdate({ mode: value as "cookies_and_cache" | "full" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cookies_and_cache">
              {t("automation.cleanupMode.cookiesAndCache")}
            </SelectItem>
            <SelectItem value="full">
              {t("automation.cleanupMode.full")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {node.mode === "cookies_and_cache"
            ? t("automation.cleanupMode.cookiesAndCacheDesc")
            : t("automation.cleanupMode.fullDesc")}
        </p>
      </div>
    </div>
  );
}
