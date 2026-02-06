# Frontend Features by Workflow Step

This document tracks implemented frontend features, their test coverage, and planned functionality.

**Legend:**
- ✅ Implemented & Tested
- ⏳ Partially implemented / disabled
- ❌ Not yet implemented

**Test File:** `complete-workflow.spec.ts` - Single comprehensive E2E test covering all features.

---

## Landing Page (Project Management)

| Feature | Status | Test Section |
|---------|--------|--------------|
| App launch | ✅ | `LANDING PAGE: App Launch & Backend Status` |
| Backend status indicator | ✅ | `LANDING PAGE: App Launch & Backend Status` |
| List projects | ✅ | `LANDING PAGE: Project Creation` |
| Create new project | ✅ | `LANDING PAGE: Project Creation` |
| Refresh projects | ✅ | - |
| Delete project | ❌ | - |

**data-testid attributes:**
- `project-id-input` - New project name input
- `submit-create-project` - Create project button
- `cancel-create-project` - Cancel button
- `project-card-{projectId}` - Project card (dynamic)

---

## Project Overview

| Feature | Status | Test Section |
|---------|--------|--------------|
| Navigate to project | ✅ | `PROJECT OVERVIEW: Navigation & Display` |
| Workflow progress visualization | ✅ | `PROJECT OVERVIEW: Navigation & Display` |
| Record status breakdown | ✅ | `PROJECT OVERVIEW: Navigation & Display` |
| Quick stats cards | ✅ | `PROJECT OVERVIEW: Navigation & Display` |
| Next step suggestion with CTA | ✅ | - |

---

## 1. Search

| Feature | Status | Test Section |
|---------|--------|--------------|
| Display search sources | ✅ | `SEARCH PAGE: Navigation & Display` |
| Add PubMed API source | ✅ | `SEARCH: Add PubMed API Source` |
| Edit search source | ✅ | `SEARCH: Edit Source` |
| Delete search source | ✅ | `SEARCH: Delete Source` |
| Run search operation | ✅ | `SEARCH: Run Search Operation` |
| File upload dialog | ✅ | `SEARCH: File Upload Dialog` |

**data-testid attributes:**
- `add-source-button` - Add source dropdown trigger
- `add-source-menu` - Dropdown menu
- `add-api-source-option` - PubMed option
- `add-file-source-option` - Database export option
- `pubmed-query-input` - PubMed query input
- `submit-add-pubmed` - Submit PubMed source
- `source-card-pubmed` - PubMed source card
- `edit-source-pubmed` - Edit button
- `delete-source-pubmed` - Delete button
- `edit-query-input` - Edit dialog query input
- `confirm-edit-source` - Confirm edit
- `confirm-delete-source` - Confirm delete
- `run-search-button` - Run search
- `source-name-input` - File source name
- `file-input` - File upload input
- `submit-add-source` - Submit file source
- `cancel-add-source` - Cancel dialog

---

## 2. Load

| Feature | Status | Test Section |
|---------|--------|--------------|
| Display operation status | ✅ | `LOAD PAGE: Run Load Operation` |
| Run load operation | ✅ | `LOAD PAGE: Run Load Operation` |
| Show affected records count | ✅ | - |
| Show warning if can't run | ✅ | - |

**data-testid attributes:**
- `run-load-button` - Run load operation

---

## 3. Prep

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Display operation status | ✅ | - |
| Display prep rounds configuration | ✅ | - |
| Run prep operation | ✅ | - |
| Configure prep rounds | ❌ | - |

---

## 4. Dedupe

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Display operation status | ✅ | - |
| Display dedupe packages | ✅ | - |
| Run dedupe operation | ✅ | - |
| Manual duplicate resolution | ❌ | - |

---

## 5. Prescreen

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Load prescreen queue (paginated) | ✅ | - |
| Display record details | ✅ | - |
| Include/Exclude decision buttons | ✅ | - |
| Queue navigation | ✅ | - |
| Bulk operations | ❌ | - |

---

## 6. PDF Get

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Display operation status | ✅ | - |
| Display PDF settings | ✅ | - |
| Run pdf_get operation | ✅ | - |
| Manual PDF upload | ❌ | - |

---

## 7. PDF Prep

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Display operation status | ✅ | - |
| Display prep packages | ✅ | - |
| Run pdf_prep operation | ✅ | - |
| Manual PDF validation | ❌ | - |

---

## 8. Screen

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Load screen queue (paginated) | ✅ | - |
| Display record details | ✅ | - |
| Display screening criteria panel | ✅ | - |
| Include/Exclude decision buttons | ✅ | - |
| Open PDF viewer | ❌ | - |

---

## 9. Data

| Feature | Status | Test Section |
|---------|--------|--------------|
| Page navigation | ✅ | `NAVIGATION: Workflow Steps` |
| Display operation status | ✅ | - |
| Display data packages | ✅ | - |
| Run data operation | ✅ | - |
| Data extraction interface | ❌ | - |

---

## Workflow Progress Indicators

| Feature | Status | Test Section |
|---------|--------|--------------|
| Sidebar step indicators | ✅ | `WORKFLOW PROGRESS: Initial Step Statuses` |
| Status updates after search | ✅ | `WORKFLOW PROGRESS: Status After Search` |
| Status updates after load | ✅ | `LOAD PAGE: Run Load Operation` |

**data-testid attributes:**
- `sidebar-search` - Search step (with `data-step-status`)
- `sidebar-load` - Load step (with `data-step-status`)
- `sidebar-prep` - Prep step (with `data-step-status`)
- `sidebar-dedupe` - Dedupe step
- `sidebar-prescreen` - Prescreen step
- `sidebar-pdf_get` - PDF Get step
- `sidebar-pdf_prep` - PDF Prep step
- `sidebar-screen` - Screen step
- `sidebar-data` - Data step

---

## Settings

| Feature | Status | Test Section |
|---------|--------|--------------|
| Display project info | ✅ | - |
| Display authors | ✅ | - |
| Display Git repository info | ✅ | - |
| Edit project settings | ⏳ | - |

---

## E2E Test Structure

### complete-workflow.spec.ts

Single comprehensive test covering the full workflow:

1. **LANDING PAGE: App Launch & Backend Status** - App launch, backend startup
2. **LANDING PAGE: Project Creation** - Create new project
3. **PROJECT OVERVIEW: Navigation & Display** - Navigate to project, verify overview
4. **WORKFLOW PROGRESS: Initial Step Statuses** - Verify sidebar indicators
5. **SEARCH PAGE: Navigation & Display** - Navigate to search, verify UI
6. **SEARCH: Add PubMed API Source** - Add API source
7. **SEARCH: Edit Source** - Edit source query
8. **SEARCH: Delete Source** - Remove source
9. **SEARCH: Run Search Operation** - Execute search
10. **SEARCH: File Upload Dialog** - Test file upload UI
11. **WORKFLOW PROGRESS: Status After Search** - Verify status updates
12. **LOAD PAGE: Run Load Operation** - Run load, verify status
13. **NAVIGATION: Workflow Steps** - Navigate all pages

---

## Adding Tests

When implementing new features:

1. Add `data-testid` attributes to interactive elements
2. Add a new section to `complete-workflow.spec.ts`
3. Update this document with the feature and test section
