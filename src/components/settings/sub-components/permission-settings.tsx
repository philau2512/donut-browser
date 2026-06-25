"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { BsCamera, BsMic } from "react-icons/bs";
import { LoadingButton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { PermissionType } from "@/hooks/use-permissions";

interface PermissionInfo {
  permission_type: PermissionType;
  isGranted: boolean;
  description: string;
}

interface PermissionSettingsProps {
  permissions: PermissionInfo[];
  isLoadingPermissions: boolean;
  requestingPermission: PermissionType | null;
  handleRequestPermission: (type: PermissionType) => Promise<void>;
}

export function PermissionSettings({
  permissions,
  isLoadingPermissions,
  requestingPermission,
  handleRequestPermission,
}: PermissionSettingsProps) {
  const { t } = useTranslation();

  const getPermissionIcon = React.useCallback((type: PermissionType) => {
    switch (type) {
      case "microphone":
        return <BsMic className="size-4" />;
      case "camera":
        return <BsCamera className="size-4" />;
    }
  }, []);

  const getPermissionDisplayName = React.useCallback(
    (type: PermissionType) => {
      switch (type) {
        case "microphone":
          return t("settings.permissions.microphone");
        case "camera":
          return t("settings.permissions.camera");
      }
    },
    [t],
  );

  const getStatusBadge = React.useCallback(
    (isGranted: boolean) => {
      if (isGranted) {
        return (
          <Badge
            variant="default"
            className="bg-success text-success-foreground"
          >
            {t("common.status.granted")}
          </Badge>
        );
      }
      return <Badge variant="secondary">{t("common.status.notGranted")}</Badge>;
    },
    [t],
  );

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        {t("settings.permissions.title")}
      </Label>

      {isLoadingPermissions ? (
        <div className="text-sm text-muted-foreground">
          {t("settings.permissions.loading")}
        </div>
      ) : (
        <div className="space-y-3">
          {permissions.map((permission) => (
            <div
              key={permission.permission_type}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-x-3">
                {getPermissionIcon(permission.permission_type)}
                <div>
                  <div className="text-sm font-medium">
                    {getPermissionDisplayName(permission.permission_type)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {permission.description}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-x-2">
                {getStatusBadge(permission.isGranted)}
                {!permission.isGranted && (
                  <LoadingButton
                    size="sm"
                    isLoading={
                      requestingPermission === permission.permission_type
                    }
                    onClick={() => {
                      void handleRequestPermission(permission.permission_type);
                    }}
                  >
                    Grant
                  </LoadingButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        These permissions allow browsers launched from Donut Browser to access
        system resources. Each website will still ask for your permission
        individually.
      </p>
    </div>
  );
}
