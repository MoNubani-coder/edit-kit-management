-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ENGINEER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'CHECKED_OUT', 'MAINTENANCE', 'DAMAGED', 'MISSING', 'RETIRED');

-- CreateEnum
CREATE TYPE "KitStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'CHECKED_OUT', 'MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "SuitcaseStatus" AS ENUM ('GOOD', 'MINOR_DAMAGE', 'DAMAGED', 'MISSING', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'RESERVED', 'READY_FOR_HANDOVER', 'CHECKED_OUT', 'OVERDUE', 'RETURN_INSPECTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('HANDOVER', 'RETURN');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('IN_PROGRESS', 'PENDING_SIGNATURES', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ItemConditionStatus" AS ENUM ('INCLUDED', 'MISSING', 'DAMAGED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "SoftwareStatus" AS ENUM ('INSTALLED', 'NOT_INSTALLED', 'LICENSE_ISSUE', 'NEEDS_UPDATE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ChecklistPhase" AS ENUM ('HANDOVER', 'RETURN', 'BOTH');

-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('HANDOVER_EDITOR', 'HANDOVER_ENGINEER', 'RETURN_EDITOR', 'RETURN_ENGINEER');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('EDITOR', 'ENGINEER');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('MISSING', 'DAMAGED', 'MALFUNCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('INSPECTION_PHOTO', 'ISSUE_PHOTO', 'SIGNATURE', 'DOCUMENT', 'GENERATED_PDF');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'AZURE_BLOB');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'ROLE_CHANGED', 'BOOKING_CREATED', 'BOOKING_UPDATED', 'BOOKING_STATUS_CHANGED', 'BOOKING_CANCELLED', 'KIT_ASSIGNED', 'ASSET_STATUS_CHANGED', 'KIT_STATUS_CHANGED', 'HANDOVER_STARTED', 'HANDOVER_COMPLETED', 'RETURN_STARTED', 'RETURN_COMPLETED', 'SIGNATURE_SUBMITTED', 'SIGNATURE_VOIDED', 'INSPECTION_VOIDED', 'ISSUE_CREATED', 'ISSUE_UPDATED', 'ISSUE_RESOLVED', 'ISSUE_CLOSED', 'ADMIN_OVERRIDE', 'EXPORT_GENERATED', 'SETTING_CHANGED', 'FILE_UPLOADED', 'FILE_DELETED');

-- CreateEnum
CREATE TYPE "NumberScope" AS ENUM ('BOOKING', 'ASSET', 'ISSUE', 'KIT', 'INSPECTION');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "staffId" TEXT,
    "phone" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "editor_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "staffId" TEXT,
    "email" TEXT,
    "contactNumber" TEXT,
    "department" TEXT,
    "company" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "editor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "staffId" TEXT,
    "email" TEXT,
    "contactNumber" TEXT,
    "department" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engineer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentId" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equipment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accessory_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "admBarcode" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" TEXT,
    "location" TEXT,
    "purchaseDate" TIMESTAMPTZ(3),
    "warrantyEnd" TIMESTAMPTZ(3),
    "notes" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessories" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "accessoryTypeId" TEXT NOT NULL,
    "label" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "serialNumber" TEXT,
    "admBarcode" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_status_logs" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromStatus" "AssetStatus",
    "toStatus" "AssetStatus" NOT NULL,
    "reason" TEXT,
    "bookingId" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kits" (
    "id" TEXT NOT NULL,
    "kitCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "admBarcode" TEXT,
    "status" "KitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "suitcaseStatus" "SuitcaseStatus" NOT NULL DEFAULT 'GOOD',
    "location" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultChecklistTemplateId" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_assets" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "slotLabel" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),

    CONSTRAINT "kit_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_applications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "version" TEXT,
    "licenseType" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "software_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_software" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "softwareApplicationId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kit_software_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "phase" "ChecklistPhase" NOT NULL DEFAULT 'BOTH',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "bookingStart" TIMESTAMPTZ(3) NOT NULL,
    "bookingEnd" TIMESTAMPTZ(3) NOT NULL,
    "collectionDate" TIMESTAMPTZ(3),
    "expectedReturnDate" TIMESTAMPTZ(3) NOT NULL,
    "actualReturnDate" TIMESTAMPTZ(3),
    "purpose" TEXT,
    "notes" TEXT,
    "checklistTemplateId" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_checklist_items" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sourceTemplateItemId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "phase" "ChecklistPhase" NOT NULL DEFAULT 'BOTH',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "suitcaseStatus" "SuitcaseStatus" NOT NULL DEFAULT 'GOOD',
    "generalNotes" TEXT,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "documentSnapshot" JSONB,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_inspections" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kitAssetId" TEXT,
    "status" "ItemConditionStatus" NOT NULL DEFAULT 'INCLUDED',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "slotLabelSnapshot" TEXT,
    "assetCodeSnapshot" TEXT NOT NULL,
    "categoryNameSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "manufacturerSnapshot" TEXT,
    "modelSnapshot" TEXT,
    "serialNumberSnapshot" TEXT,
    "admBarcodeSnapshot" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_inspections" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "assetInspectionId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "status" "ItemConditionStatus" NOT NULL DEFAULT 'INCLUDED',
    "quantityExpected" INTEGER NOT NULL DEFAULT 1,
    "quantityReceived" INTEGER,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "labelSnapshot" TEXT NOT NULL,
    "accessoryTypeSnapshot" TEXT NOT NULL,
    "serialNumberSnapshot" TEXT,
    "admBarcodeSnapshot" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accessory_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_checks" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "softwareApplicationId" TEXT NOT NULL,
    "status" "SoftwareStatus" NOT NULL DEFAULT 'INSTALLED',
    "installedVersion" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nameSnapshot" TEXT NOT NULL,
    "versionSnapshot" TEXT,
    "vendorSnapshot" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "software_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_results" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "bookingChecklistItemId" TEXT NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'PASS',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checklist_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "type" "SignatureType" NOT NULL,
    "signerRole" "SignerRole" NOT NULL,
    "signerUserId" TEXT,
    "signerEditorProfileId" TEXT,
    "signerEngineerProfileId" TEXT,
    "signerName" TEXT NOT NULL,
    "signerStaffId" TEXT,
    "storageProvider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "imagePath" TEXT NOT NULL,
    "imageMimeType" TEXT NOT NULL DEFAULT 'image/png',
    "imageHash" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "issueNumber" TEXT NOT NULL,
    "type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bookingId" TEXT,
    "inspectionId" TEXT,
    "kitId" TEXT,
    "assetId" TEXT,
    "accessoryId" TEXT,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToId" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storagePath" TEXT NOT NULL,
    "caption" TEXT,
    "bookingId" TEXT,
    "inspectionId" TEXT,
    "assetInspectionId" TEXT,
    "accessoryInspectionId" TEXT,
    "issueId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" "UserRole",
    "summary" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "scope" "NumberScope" NOT NULL,
    "period" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_staffId_key" ON "users"("staffId");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "editor_profiles_userId_key" ON "editor_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "editor_profiles_staffId_key" ON "editor_profiles"("staffId");

-- CreateIndex
CREATE INDEX "editor_profiles_fullName_idx" ON "editor_profiles"("fullName");

-- CreateIndex
CREATE INDEX "editor_profiles_isActive_deletedAt_idx" ON "editor_profiles"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "engineer_profiles_userId_key" ON "engineer_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "engineer_profiles_staffId_key" ON "engineer_profiles"("staffId");

-- CreateIndex
CREATE INDEX "engineer_profiles_fullName_idx" ON "engineer_profiles"("fullName");

-- CreateIndex
CREATE INDEX "engineer_profiles_isActive_deletedAt_idx" ON "engineer_profiles"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_categories_code_key" ON "equipment_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_categories_name_key" ON "equipment_categories"("name");

-- CreateIndex
CREATE INDEX "equipment_categories_sortOrder_idx" ON "equipment_categories"("sortOrder");

-- CreateIndex
CREATE INDEX "equipment_categories_parentId_idx" ON "equipment_categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_types_code_key" ON "accessory_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_types_name_key" ON "accessory_types"("name");

-- CreateIndex
CREATE INDEX "accessory_types_sortOrder_idx" ON "accessory_types"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "assets_assetCode_key" ON "assets"("assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "assets_serialNumber_key" ON "assets"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "assets_admBarcode_key" ON "assets"("admBarcode");

-- CreateIndex
CREATE INDEX "assets_categoryId_idx" ON "assets"("categoryId");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_admBarcode_idx" ON "assets"("admBarcode");

-- CreateIndex
CREATE INDEX "assets_serialNumber_idx" ON "assets"("serialNumber");

-- CreateIndex
CREATE INDEX "assets_deletedAt_idx" ON "assets"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "accessories_admBarcode_key" ON "accessories"("admBarcode");

-- CreateIndex
CREATE INDEX "accessories_assetId_sortOrder_idx" ON "accessories"("assetId", "sortOrder");

-- CreateIndex
CREATE INDEX "accessories_accessoryTypeId_idx" ON "accessories"("accessoryTypeId");

-- CreateIndex
CREATE INDEX "accessories_admBarcode_idx" ON "accessories"("admBarcode");

-- CreateIndex
CREATE INDEX "asset_status_logs_assetId_createdAt_idx" ON "asset_status_logs"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "asset_status_logs_bookingId_idx" ON "asset_status_logs"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "kits_kitCode_key" ON "kits"("kitCode");

-- CreateIndex
CREATE UNIQUE INDEX "kits_admBarcode_key" ON "kits"("admBarcode");

-- CreateIndex
CREATE INDEX "kits_status_idx" ON "kits"("status");

-- CreateIndex
CREATE INDEX "kits_admBarcode_idx" ON "kits"("admBarcode");

-- CreateIndex
CREATE INDEX "kits_isActive_deletedAt_idx" ON "kits"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "kit_assets_kitId_sortOrder_idx" ON "kit_assets"("kitId", "sortOrder");

-- CreateIndex
CREATE INDEX "kit_assets_assetId_idx" ON "kit_assets"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "kit_assets_kitId_assetId_key" ON "kit_assets"("kitId", "assetId");

-- CreateIndex
CREATE INDEX "software_applications_isActive_sortOrder_idx" ON "software_applications"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "software_applications_name_version_key" ON "software_applications"("name", "version");

-- CreateIndex
CREATE INDEX "kit_software_kitId_sortOrder_idx" ON "kit_software"("kitId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "kit_software_kitId_softwareApplicationId_key" ON "kit_software"("kitId", "softwareApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_name_key" ON "checklist_templates"("name");

-- CreateIndex
CREATE INDEX "checklist_templates_isActive_isDefault_idx" ON "checklist_templates"("isActive", "isDefault");

-- CreateIndex
CREATE INDEX "checklist_template_items_templateId_sortOrder_idx" ON "checklist_template_items"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingNumber_key" ON "bookings"("bookingNumber");

-- CreateIndex
CREATE INDEX "bookings_kitId_status_idx" ON "bookings"("kitId", "status");

-- CreateIndex
CREATE INDEX "bookings_editorId_idx" ON "bookings"("editorId");

-- CreateIndex
CREATE INDEX "bookings_engineerId_idx" ON "bookings"("engineerId");

-- CreateIndex
CREATE INDEX "bookings_status_expectedReturnDate_idx" ON "bookings"("status", "expectedReturnDate");

-- CreateIndex
CREATE INDEX "bookings_bookingStart_bookingEnd_idx" ON "bookings"("bookingStart", "bookingEnd");

-- CreateIndex
CREATE INDEX "bookings_deletedAt_idx" ON "bookings"("deletedAt");

-- CreateIndex
CREATE INDEX "booking_checklist_items_bookingId_sortOrder_idx" ON "booking_checklist_items"("bookingId", "sortOrder");

-- CreateIndex
CREATE INDEX "inspections_bookingId_type_idx" ON "inspections"("bookingId", "type");

-- CreateIndex
CREATE INDEX "inspections_status_idx" ON "inspections"("status");

-- CreateIndex
CREATE INDEX "asset_inspections_inspectionId_sortOrder_idx" ON "asset_inspections"("inspectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "asset_inspections_assetId_idx" ON "asset_inspections"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_inspections_inspectionId_assetId_key" ON "asset_inspections"("inspectionId", "assetId");

-- CreateIndex
CREATE INDEX "accessory_inspections_assetInspectionId_sortOrder_idx" ON "accessory_inspections"("assetInspectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "accessory_inspections_accessoryId_idx" ON "accessory_inspections"("accessoryId");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_inspections_inspectionId_accessoryId_key" ON "accessory_inspections"("inspectionId", "accessoryId");

-- CreateIndex
CREATE INDEX "software_checks_inspectionId_sortOrder_idx" ON "software_checks"("inspectionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "software_checks_inspectionId_softwareApplicationId_key" ON "software_checks"("inspectionId", "softwareApplicationId");

-- CreateIndex
CREATE INDEX "checklist_results_inspectionId_idx" ON "checklist_results"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_results_inspectionId_bookingChecklistItemId_key" ON "checklist_results"("inspectionId", "bookingChecklistItemId");

-- CreateIndex
CREATE INDEX "signatures_inspectionId_type_idx" ON "signatures"("inspectionId", "type");

-- CreateIndex
CREATE INDEX "signatures_bookingId_idx" ON "signatures"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "issues_issueNumber_key" ON "issues"("issueNumber");

-- CreateIndex
CREATE INDEX "issues_status_severity_idx" ON "issues"("status", "severity");

-- CreateIndex
CREATE INDEX "issues_assetId_status_idx" ON "issues"("assetId", "status");

-- CreateIndex
CREATE INDEX "issues_bookingId_idx" ON "issues"("bookingId");

-- CreateIndex
CREATE INDEX "issues_kitId_idx" ON "issues"("kitId");

-- CreateIndex
CREATE INDEX "attachments_bookingId_idx" ON "attachments"("bookingId");

-- CreateIndex
CREATE INDEX "attachments_inspectionId_idx" ON "attachments"("inspectionId");

-- CreateIndex
CREATE INDEX "attachments_issueId_idx" ON "attachments"("issueId");

-- CreateIndex
CREATE INDEX "attachments_sha256_idx" ON "attachments"("sha256");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_scope_period_key" ON "number_sequences"("scope", "period");

-- CreateIndex
CREATE INDEX "app_settings_category_idx" ON "app_settings"("category");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_profiles" ADD CONSTRAINT "editor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_profiles" ADD CONSTRAINT "engineer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "equipment_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "equipment_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_accessoryTypeId_fkey" FOREIGN KEY ("accessoryTypeId") REFERENCES "accessory_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_logs" ADD CONSTRAINT "asset_status_logs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_logs" ADD CONSTRAINT "asset_status_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_logs" ADD CONSTRAINT "asset_status_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kits" ADD CONSTRAINT "kits_defaultChecklistTemplateId_fkey" FOREIGN KEY ("defaultChecklistTemplateId") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_assets" ADD CONSTRAINT "kit_assets_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_assets" ADD CONSTRAINT "kit_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_software" ADD CONSTRAINT "kit_software_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_software" ADD CONSTRAINT "kit_software_softwareApplicationId_fkey" FOREIGN KEY ("softwareApplicationId") REFERENCES "software_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "editor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "engineer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_checklist_items" ADD CONSTRAINT "booking_checklist_items_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_checklist_items" ADD CONSTRAINT "booking_checklist_items_sourceTemplateItemId_fkey" FOREIGN KEY ("sourceTemplateItemId") REFERENCES "checklist_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_inspections" ADD CONSTRAINT "asset_inspections_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_inspections" ADD CONSTRAINT "asset_inspections_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_inspections" ADD CONSTRAINT "accessory_inspections_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_inspections" ADD CONSTRAINT "accessory_inspections_assetInspectionId_fkey" FOREIGN KEY ("assetInspectionId") REFERENCES "asset_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_inspections" ADD CONSTRAINT "accessory_inspections_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_checks" ADD CONSTRAINT "software_checks_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_checks" ADD CONSTRAINT "software_checks_softwareApplicationId_fkey" FOREIGN KEY ("softwareApplicationId") REFERENCES "software_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_bookingChecklistItemId_fkey" FOREIGN KEY ("bookingChecklistItemId") REFERENCES "booking_checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signerEditorProfileId_fkey" FOREIGN KEY ("signerEditorProfileId") REFERENCES "editor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signerEngineerProfileId_fkey" FOREIGN KEY ("signerEngineerProfileId") REFERENCES "engineer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "accessories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_assetInspectionId_fkey" FOREIGN KEY ("assetInspectionId") REFERENCES "asset_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_accessoryInspectionId_fkey" FOREIGN KEY ("accessoryInspectionId") REFERENCES "accessory_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
