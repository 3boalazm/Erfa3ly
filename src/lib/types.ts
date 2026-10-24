import type { ArtifactKind } from "@/lib/tree";

export interface SiteSummary {
  id: string;
  title: string;
  kind: ArtifactKind;
  entryPath: string;
  currentVersionId: string | null;
  fileCount: number;
  byteSize: number;
  needsRuntime: boolean;
  runtimeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  shareCount: number;
}

export interface VersionSummary {
  id: string;
  siteId: string;
  parentVersionId: string | null;
  source: string;
  entryPath: string;
  rootPrefix: string;
  fileCount: number;
  byteSize: number;
  note: string | null;
  createdAt: Date;
}

export interface ShareSummary {
  id: string;
  siteId: string;
  versionId: string | null;
  token: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  views: number;
}

export interface SiteDetail extends SiteSummary {
  versions: VersionSummary[];
  shares: ShareSummary[];
  current: VersionSummary | null;
}

export interface UploadTarget {
  path: string;
  size: number;
}

export type UploadKind = "files" | "zip" | "document";

export interface UploadSession {
  id: string;
  ownerId: string;
  siteId: string;
  versionId: string;
  kind: UploadKind;
  state: "open" | "committed" | "failed";
  expectedFiles: UploadTarget[];
  declaredBytes: number;
  title: string | null;
  createdAt: Date;
  expiresAt: Date;
}
