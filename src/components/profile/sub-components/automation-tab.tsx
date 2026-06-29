import { closestCenter, DndContext, DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Info, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  AutomationNodeConfig,
  AutomationVariable,
  ProfileAutomation,
} from "@/types";
import { AutomationNodeCard } from "./automation-node-card";

interface AutomationTabProps {
  automation: ProfileAutomation | undefined;
  onChange: (automation: ProfileAutomation | undefined) => void;
}

type NodeWithId = AutomationNodeConfig & { id: string; enabled: boolean };

const _AVAILABLE_VARIABLES: Record<string, AutomationVariable[]> = {
  before_open: ["profile_id", "profile_name"],
  after_close: ["profile_id", "profile_name"],
};

export function AutomationTab({ automation, onChange }: AutomationTabProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(!!automation);

  const beforeOpenNodes: NodeWithId[] = (automation?.before_open || []).map(
    (node, i) => ({
      ...node,
      id: `before-${i}`,
      enabled: true,
    }),
  );

  const afterCloseNodes: NodeWithId[] = (automation?.after_close || []).map(
    (node, i) => ({
      ...node,
      id: `after-${i}`,
      enabled: true,
    }),
  );

  const handleToggleEnabled = useCallback(
    (newEnabled: boolean) => {
      setEnabled(newEnabled);
      if (!newEnabled) {
        onChange(undefined);
      } else {
        onChange({
          before_open: [],
          after_close: [],
        });
      }
    },
    [onChange],
  );

  const createDefaultNode = (
    type: AutomationNodeConfig["type"],
  ): AutomationNodeConfig => {
    const baseConfig = {
      timeout_seconds: 30,
      max_attempts: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2.0,
    };

    switch (type) {
      case "dynamic_proxy":
        return {
          type,
          label: t("automation.nodeTypes.dynamicProxy"),
          api_url: "",
          headers: {},
          response_format: "json",
          protocol: "http",
          ...baseConfig,
        };
      case "ip_check":
        return {
          type,
          label: t("automation.nodeTypes.ipCheck"),
          allowed_countries: [],
          max_fraud_score: 100,
          use_proxy: true,
          ...baseConfig,
        };
      case "local_command":
        return {
          type,
          label: t("automation.nodeTypes.localCommand"),
          command: "",
          env_vars: {},
          timeout_seconds: 300,
          ...baseConfig,
        };
      case "webhook":
        return {
          type,
          label: t("automation.nodeTypes.webhook"),
          url: "",
          method: "POST",
          headers: {},
          ...baseConfig,
        };
      case "telegram_alert":
        return {
          type,
          label: t("automation.nodeTypes.telegramAlert"),
          bot_token: "",
          chat_id: "",
          message: "",
          ...baseConfig,
        };
      case "cleanup":
        return {
          type,
          label: t("automation.nodeTypes.cleanup"),
          mode: "cookies_and_cache",
          exclude_domains: [],
        };
    }
  };

  const handleAddNode = (
    stage: "before_open" | "after_close",
    nodeType: AutomationNodeConfig["type"],
  ) => {
    const newNode = createDefaultNode(nodeType);
    const currentNodes =
      stage === "before_open"
        ? automation?.before_open || []
        : automation?.after_close || [];

    onChange({
      ...automation,
      before_open: automation?.before_open || [],
      after_close: automation?.after_close || [],
      [stage]: [...currentNodes, newNode],
    });
  };

  const handleUpdateNode = (
    stage: "before_open" | "after_close",
    index: number,
    updates: Partial<AutomationNodeConfig>,
  ) => {
    const nodes =
      stage === "before_open"
        ? automation?.before_open || []
        : automation?.after_close || [];
    const updatedNodes = nodes.map((node, i) =>
      i === index ? { ...node, ...updates } : node,
    );

    onChange({
      ...automation,
      before_open: automation?.before_open || [],
      after_close: automation?.after_close || [],
      [stage]: updatedNodes,
    });
  };

  const handleDeleteNode = (
    stage: "before_open" | "after_close",
    index: number,
  ) => {
    const nodes =
      stage === "before_open"
        ? automation?.before_open || []
        : automation?.after_close || [];
    const filteredNodes = nodes.filter((_, i) => i !== index);

    onChange({
      ...automation,
      before_open: automation?.before_open || [],
      after_close: automation?.after_close || [],
      [stage]: filteredNodes,
    });
  };

  const handleMoveNode = (
    stage: "before_open" | "after_close",
    index: number,
    direction: "up" | "down",
  ) => {
    const nodes =
      stage === "before_open"
        ? automation?.before_open || []
        : automation?.after_close || [];
    const newIndex = direction === "up" ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= nodes.length) return;

    const reorderedNodes = arrayMove(nodes, index, newIndex);

    onChange({
      ...automation,
      before_open: automation?.before_open || [],
      after_close: automation?.after_close || [],
      [stage]: reorderedNodes,
    });
  };

  const handleDragEnd =
    (stage: "before_open" | "after_close") => (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) return;

      const nodes =
        stage === "before_open"
          ? automation?.before_open || []
          : automation?.after_close || [];
      const oldIndex = nodes.findIndex(
        (_, i) =>
          `${stage === "before_open" ? "before" : "after"}-${i}` === active.id,
      );
      const newIndex = nodes.findIndex(
        (_, i) =>
          `${stage === "before_open" ? "before" : "after"}-${i}` === over.id,
      );

      if (oldIndex === -1 || newIndex === -1) return;

      const reorderedNodes = arrayMove(nodes, oldIndex, newIndex);

      onChange({
        ...automation,
        before_open: automation?.before_open || [],
        after_close: automation?.after_close || [],
        [stage]: reorderedNodes,
      });
    };

  const checkVariableDependency = (
    node: AutomationNodeConfig,
    stage: "before_open" | "after_close",
  ): {
    hasIssue: boolean;
    warning?: string;
  } => {
    // Check if node uses variables that aren't available yet
    const nodeIndex =
      stage === "before_open"
        ? beforeOpenNodes.indexOf(node)
        : afterCloseNodes.indexOf(node);

    const nodesBefore =
      stage === "before_open"
        ? beforeOpenNodes.slice(0, nodeIndex)
        : afterCloseNodes.slice(0, nodeIndex);

    let usesProxyVars = false;
    let usesIpVars = false;

    // Check if node config contains proxy variables
    const nodeStr = JSON.stringify(node);
    if (
      nodeStr.includes("{{proxy_ip}}") ||
      nodeStr.includes("{{proxy_port}}")
    ) {
      usesProxyVars = true;
    }
    if (
      nodeStr.includes("{{ip_country}}") ||
      nodeStr.includes("{{ip_fraud_score}}")
    ) {
      usesIpVars = true;
    }

    // Check if required nodes are present before this one
    const hasDynamicProxyBefore = nodesBefore.some(
      (n) => n.type === "dynamic_proxy",
    );
    const hasIpCheckBefore = nodesBefore.some((n) => n.type === "ip_check");

    if (usesProxyVars && !hasDynamicProxyBefore) {
      return {
        hasIssue: true,
        warning: t("automation.warnings.proxyVariableNotAvailable"),
      };
    }

    if (usesIpVars && !hasIpCheckBefore) {
      return {
        hasIssue: true,
        warning: t("automation.warnings.ipVariableNotAvailable"),
      };
    }

    return { hasIssue: false };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t("automation.masterSwitch")}</Label>
          <p className="text-sm text-muted-foreground">
            {t("automation.masterSwitchDescription")}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
      </div>

      {enabled && (
        <>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>{t("automation.infoMessage")}</AlertDescription>
          </Alert>

          {/* Before Open Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t("automation.beforeOpen.title")}</CardTitle>
              <CardDescription>
                {t("automation.beforeOpen.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd("before_open")}
              >
                <SortableContext
                  items={beforeOpenNodes.map((n) => n.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {beforeOpenNodes.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {t("automation.noNodes")}
                    </div>
                  ) : (
                    beforeOpenNodes.map((node, index) => {
                      const { hasIssue, warning } = checkVariableDependency(
                        node,
                        "before_open",
                      );
                      return (
                        <AutomationNodeCard
                          key={node.id}
                          node={node}
                          index={index}
                          total={beforeOpenNodes.length}
                          onUpdate={(updates) =>
                            handleUpdateNode("before_open", index, updates)
                          }
                          onDelete={() =>
                            handleDeleteNode("before_open", index)
                          }
                          onMoveUp={() =>
                            handleMoveNode("before_open", index, "up")
                          }
                          onMoveDown={() =>
                            handleMoveNode("before_open", index, "down")
                          }
                          onToggleEnabled={() => {}}
                          hasOrderingIssue={hasIssue}
                          orderingWarning={warning}
                        />
                      );
                    })
                  )}
                </SortableContext>
              </DndContext>

              <Select
                onValueChange={(type) =>
                  handleAddNode(
                    "before_open",
                    type as AutomationNodeConfig["type"],
                  )
                }
              >
                <SelectTrigger>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("automation.addNode")}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dynamic_proxy">
                    {t("automation.nodeTypes.dynamicProxy")}
                  </SelectItem>
                  <SelectItem value="ip_check">
                    {t("automation.nodeTypes.ipCheck")}
                  </SelectItem>
                  <SelectItem value="local_command">
                    {t("automation.nodeTypes.localCommand")}
                  </SelectItem>
                  <SelectItem value="webhook">
                    {t("automation.nodeTypes.webhook")}
                  </SelectItem>
                  <SelectItem value="telegram_alert">
                    {t("automation.nodeTypes.telegramAlert")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* After Close Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t("automation.afterClose.title")}</CardTitle>
              <CardDescription>
                {t("automation.afterClose.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd("after_close")}
              >
                <SortableContext
                  items={afterCloseNodes.map((n) => n.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {afterCloseNodes.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {t("automation.noNodes")}
                    </div>
                  ) : (
                    afterCloseNodes.map((node, index) => {
                      const { hasIssue, warning } = checkVariableDependency(
                        node,
                        "after_close",
                      );
                      return (
                        <AutomationNodeCard
                          key={node.id}
                          node={node}
                          index={index}
                          total={afterCloseNodes.length}
                          onUpdate={(updates) =>
                            handleUpdateNode("after_close", index, updates)
                          }
                          onDelete={() =>
                            handleDeleteNode("after_close", index)
                          }
                          onMoveUp={() =>
                            handleMoveNode("after_close", index, "up")
                          }
                          onMoveDown={() =>
                            handleMoveNode("after_close", index, "down")
                          }
                          onToggleEnabled={() => {}}
                          hasOrderingIssue={hasIssue}
                          orderingWarning={warning}
                        />
                      );
                    })
                  )}
                </SortableContext>
              </DndContext>

              <Select
                onValueChange={(type) =>
                  handleAddNode(
                    "after_close",
                    type as AutomationNodeConfig["type"],
                  )
                }
              >
                <SelectTrigger>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("automation.addNode")}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cleanup">
                    {t("automation.nodeTypes.cleanup")}
                  </SelectItem>
                  <SelectItem value="webhook">
                    {t("automation.nodeTypes.webhook")}
                  </SelectItem>
                  <SelectItem value="telegram_alert">
                    {t("automation.nodeTypes.telegramAlert")}
                  </SelectItem>
                  <SelectItem value="local_command">
                    {t("automation.nodeTypes.localCommand")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
