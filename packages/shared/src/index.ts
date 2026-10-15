import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  serverVersion: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ServerStatusSchema = z.object({
  name: z.string(),
  online: z.boolean(),
  serverVersion: z.string(),
  library: z.object({
    mediaCount: z.number(),
    storageBytes: z.number(),
  }),
  disk: z.object({
    freeBytes: z.number(),
  }),
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const MediaItemSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
  mediaType: z.enum(["photo", "video"]),
  mimeType: z.string(),
  byteSize: z.number(),
  createdAt: z.string(),
  importedAt: z.string(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  thumbnailUrl: z.string().optional(),
  source: z.string().optional(),
  caption: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const MediaListResponseSchema = z.object({
  items: z.array(MediaItemSchema),
  nextCursor: z.string().optional(),
});
export type MediaListResponse = z.infer<typeof MediaListResponseSchema>;

export const MediaTypeFilterSchema = z.enum(["all", "photo", "video"]);
export type MediaTypeFilter = z.infer<typeof MediaTypeFilterSchema>;

export const CandidateAssetSchema = z.object({
  sourceAssetId: z.string(),
  originalFilename: z.string(),
  mediaType: z.enum(["photo", "video"]),
  mimeType: z.string(),
  byteSize: z.number(),
  createdAt: z.string(),
});
export type CandidateAsset = z.infer<typeof CandidateAssetSchema>;

export const SyncPlanRequestSchema = z.object({
  items: z.array(CandidateAssetSchema),
});
export type SyncPlanRequest = z.infer<typeof SyncPlanRequestSchema>;

export const SyncPlanResponseSchema = z.object({
  newItems: z.array(CandidateAssetSchema),
  alreadyPresentCount: z.number(),
  totalBytesToUpload: z.number(),
});
export type SyncPlanResponse = z.infer<typeof SyncPlanResponseSchema>;

// Phase 7: Resumable chunked upload schemas
export const UploadInitRequestSchema = z.object({
  sourceAssetId: z.string().optional(),
  originalFilename: z.string(),
  byteSize: z.number(),
  totalChunks: z.number(),
  mimeType: z.string(),
  createdAt: z.string(),
});
export type UploadInitRequest = z.infer<typeof UploadInitRequestSchema>;

export const UploadInitResponseSchema = z.object({
  uploadId: z.string(),
  receivedChunks: z.array(z.number()),
  chunkSize: z.number(),
});
export type UploadInitResponse = z.infer<typeof UploadInitResponseSchema>;

export const UploadStatusResponseSchema = z.object({
  uploadId: z.string(),
  receivedChunks: z.array(z.number()),
  totalChunks: z.number(),
  isComplete: z.boolean(),
});
export type UploadStatusResponse = z.infer<typeof UploadStatusResponseSchema>;

// Phase 4: Albums Schemas
export const AlbumTypeSchema = z.enum(["manual", "smart", "source"]);
export type AlbumType = z.infer<typeof AlbumTypeSchema>;

export const AlbumSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  type: AlbumTypeSchema,
  itemCount: z.number().default(0),
  coverMediaId: z.string().optional().nullable(),
  coverThumbnailUrl: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Album = z.infer<typeof AlbumSchema>;

export const AlbumListResponseSchema = z.object({
  albums: z.array(AlbumSchema),
});
export type AlbumListResponse = z.infer<typeof AlbumListResponseSchema>;

export const CreateAlbumRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  mediaIds: z.array(z.string()).optional(),
});
export type CreateAlbumRequest = z.infer<typeof CreateAlbumRequestSchema>;

export const AddAlbumItemsRequestSchema = z.object({
  mediaIds: z.array(z.string()).min(1),
});
export type AddAlbumItemsRequest = z.infer<typeof AddAlbumItemsRequestSchema>;




