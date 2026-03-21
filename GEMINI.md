# AGENT_SPEC.md — PeachSpend React Native App
**Version:** 1.1.0  
**Target:** React Native (Expo) | iOS & Android (equal parity)  
**AI Model:** Google Gemini 1.5 Flash (via REST API, user-supplied key)  
**Storage:** SQLite (expo-sqlite) — local only, no external sync  
**Design System:** Luminous Noir (see DESIGN.md and SKILLS)
**Assets:** Official illustrations located in `docs/illustrations`. Use these for onboarding, empty states, and thematic elements. Copy to `app/assets/images/` when needed.

---
> **NOTE:** To manage tokens efficiently, detailed design tokens, screen specs, animation systems, AI service logic, and the agent checklist have been moved to `.agent/skills/peachspend-guidelines/SKILL.md`. Agents should refer there and use the context7 MCP server for documentation.

## 0. Agent Guardrails & Behavioral Rules

### 0.0 Project Rundown & Deliverables (CRITICAL)
- **MUST READ:** You must refer to `docs/project_rundown.md` before working on *any* screen or feature.
- **MANDATORY CHECK-IN:** As you successfully build a feature or satisfy a User Story, you **MUST** update `docs/project_rundown.md` and mark the corresponding checkbox `[x]`. Do not mark a task as complete until it functions perfectly without placeholders or errors.

### 0.1 Code Quality Gates
- **No placeholder code.** Every function must be fully implemented.
- **No hardcoded strings** outside of `constants/strings.ts`.
- **TypeScript strict mode is ON.** `any` is forbidden.
- **No `console.log` in production code.** Use the internal `logger.ts`.

### 0.2 Design Guardrails
- **NEVER use solid 1px borders**; use tonal background shifts.
- **NEVER use pure white (#FFFFFF)**; use semantic text colors.
- **NEVER use sharp corners** (min 12px / rounded-md).
- **NEVER use blue**; use Peach tokens.

### 0.3 AI Integration Guardrails
- **Gemini API key is stored only in SQLite** per user (in `settings`). 
- If absent/invalid, degrade gracefully. AI results are user-editable before saving.

### 0.4 Storage Guardrails
- SQLite via `expo-sqlite` only. No AsyncStorage, no cloud sync, no analytics SDKs.

### 0.5 Platform Parity Rules
- Equal parity for iOS and Android. Navigation via **Expo Router**.
- **OTA Updates Strategy:** OTA updates should be integrated and functional from day one.

---
## 1. Build & Environment Guardrails (CRITICAL)
- **Metro Config:** Use `metro.config.cjs` (CommonJS) on Windows to prevent protocol `'c:'` errors and resolution failures.
- **Babel & NativeWind:** For SDK 52+, inline the `react-native-css-interop` Babel configuration to bypass broken `react-native-worklets/plugin` dependencies.
- **Font Assets:** DO NOT use local `.ttf` files pathing. Use official `@expo-google-fonts` packages (e.g., `@expo-google-fonts/noto-serif`) for reliability.
- **UUID & Crypto:** Always use `uuid` v9+ with `react-native-get-random-values` polyfill imported at the very top (entry point).
- **Dependency Locking:** Use the `overrides` field in `package.json` to force specific versions of conflicting sub-dependencies (e.g., `ajv`).
- **No Experimental Compiler:** Keep `reactCompiler` disabled in `app.json` for production builds to avoid schema validation errors.

---
## 2. Project Architecture (Overview)
> **IMPORTANT:** The main React Native project and all its source folders live inside the `app/` directory at the project root.

Inside `app/`:
`app/`: Expo Router screens
`components/`: UI, charts, expenses, onboarding
`services/`: GeminiService, DatabaseService, CleanupService
`hooks/`: useExpenses, useSettings, useAnalytics, useTheme
`constants/` & `types/`: Tokens, strings, types
`utils/`: Core utilities

`docs/` (root): Contains all references for docs and screens.
---
## 3. Database Schema
- **`expenses`**: id, merchant, amount, category, note, scanned, created_at
- **`settings`**: key, value (e.g. `gemini_api_key`)
---
## 4. Dependency List
Expo ecosystem: expo (~52.x), expo-router (~4.x), expo-sqlite (~15.x), expo-camera, expo-haptics, expo-font, expo-safe-area-context, expo-blur. Others: react-native-reanimated (~3.x), react-native-svg, react-native-gesture-handler, @shopify/flash-list, uuid@9.0.1, react-native-get-random-values.