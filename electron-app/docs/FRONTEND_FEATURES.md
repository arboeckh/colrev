# Frontend Features by Workflow Step

This document tracks implemented frontend features, their test coverage, and planned functionality.

**Legend:**
- ✅ Implemented
- ⏳ Partially implemented / disabled
- ❌ Not yet implemented
- `-` No test coverage

---

## Landing Page (Project Management)

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| List projects | ✅ | `project-workflow.spec.ts` |
| Create new project | ✅ | `should create a new project` |
| Backend status indicator | ✅ | `app-launch.spec.ts` |
| Refresh projects | ✅ | - |
| Delete project | ❌ | - |

**data-testid attributes:**
- `project-id-input` - New project name input
- `submit-create-project` - Create project button
- `cancel-create-project` - Cancel button

---

## Project Overview

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Quick stats cards (Total, Included, PDF, Final) | ✅ | `should view a project` |
| Workflow progress visualization | ✅ | `should view a project` |
| Next step suggestion with CTA | ✅ | - |
| Navigate to workflow steps | ✅ | `should navigate to workflow steps` |
| Record status breakdown | ✅ | - |

**data-testid attributes:** None currently

---

## 1. Search

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display search sources | ✅ | - |
| Show source details (endpoint, type, params) | ✅ | - |
| Run search operation | ✅ | - |
| Add search source | ⏳ Button disabled | - |
| Upload search file | ⏳ Button disabled | - |

**data-testid attributes:** None currently

---

## 2. Load

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display operation status | ✅ | - |
| Show affected records count | ✅ | - |
| Show warning if can't run | ✅ | - |
| Run load operation | ✅ | - |

**data-testid attributes:** None currently

---

## 3. Prep

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display operation status | ✅ | - |
| Show affected records count | ✅ | - |
| Display prep rounds configuration | ✅ | - |
| Run prep operation | ✅ | - |
| Configure prep rounds | ❌ | - |

**data-testid attributes:** None currently

---

## 4. Dedupe

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display operation status | ✅ | - |
| Show affected records count | ✅ | - |
| Display dedupe packages | ✅ | - |
| Run dedupe operation | ✅ | - |
| Manual duplicate resolution | ❌ | - |

**data-testid attributes:** None currently

---

## 5. Prescreen

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Load prescreen queue (paginated) | ✅ | - |
| Display record details (title, author, abstract) | ✅ | - |
| Include/Exclude decision buttons | ✅ | - |
| Queue navigation (Previous, Next, Skip) | ✅ | - |
| Remaining count badge | ✅ | - |
| Auto-reload queue when empty | ✅ | - |
| Bulk operations | ❌ | - |

**data-testid attributes:** None currently

---

## 6. PDF Get

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display operation status | ✅ | - |
| Show affected records count | ✅ | - |
| Display PDF settings | ✅ | - |
| Display PDF retrieval packages | ✅ | - |
| Run pdf_get operation | ✅ | - |
| Manual PDF upload | ❌ | - |

**data-testid attributes:** None currently

---

## 7. PDF Prep

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display operation status | ✅ | - |
| Show affected records count | ✅ | - |
| Display prep packages | ✅ | - |
| Run pdf_prep operation | ✅ | - |
| Manual PDF validation | ❌ | - |

**data-testid attributes:** None currently

---

## 8. Screen

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Load screen queue (paginated) | ✅ | - |
| Display record details | ✅ | - |
| Display screening criteria panel | ✅ | - |
| Include/Exclude decision buttons | ✅ | - |
| Queue navigation | ✅ | - |
| PDF indicator | ✅ | - |
| Remaining count badge | ✅ | - |
| Auto-reload queue when empty | ✅ | - |
| Open PDF viewer | ❌ | - |
| Add notes to decision | ❌ | - |

**data-testid attributes:** None currently

---

## 9. Data

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display operation status | ✅ | - |
| Show affected records count | ✅ | - |
| Display data packages | ✅ | - |
| Run data operation | ✅ | - |
| Data extraction interface | ❌ | - |

**data-testid attributes:** None currently

---

## Settings

| Feature | Status | Test Coverage |
|---------|--------|---------------|
| Display project info (title, keywords) | ✅ | - |
| Display authors with contact info | ✅ | - |
| Display Git repository info | ✅ | - |
| Display search sources summary | ✅ | - |
| Edit project settings | ⏳ Save disabled | - |

**data-testid attributes:** None currently

---

## E2E Test Inventory

### app-launch.spec.ts (3 tests)
- `should launch the Electron app`
- `should show landing page and backend status`
- `should display backend logs`

### backend-rpc.spec.ts (4 tests)
- `should capture RPC ping request and response`
- `should list projects via RPC`
- `should capture errors in debug logs`
- `demonstrates capturing RPC for iterative debugging`

### project-workflow.spec.ts (5 tests)
- `should create a new project`
- `should view a project after creation`
- `should navigate to workflow steps`
- `should show empty state when no projects`
- `should display project cards with status`

---

## Priority Test Coverage Gaps

These features are implemented but lack test coverage:

1. **Prescreen workflow** - Interactive screening with decisions
2. **Screen workflow** - Full-text screening with criteria
3. **Run operations** - Search, Load, Prep, Dedupe, etc.
4. **Settings display** - Project configuration view

## Adding Tests

When implementing new features or adding test coverage:

1. Add `data-testid` attributes to interactive elements
2. Update this document with new features
3. Create tests in `electron-app/e2e/specs/`
4. Follow patterns in `project-workflow.spec.ts`
