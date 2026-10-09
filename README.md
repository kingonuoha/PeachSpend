# PeachSpend

PeachSpend is a premium, AI-powered expense tracking application built with **React Native (Expo)** and **Google Gemini**. It features a stunning "Luminous Noir" design system, local-first storage with **SQLite**, and intelligent expense categorization.

## Features

- **Luminous Noir UI:** A sophisticated, glassmorphic design system with vibrant "Peach" accents.
- **AI Scanning:** Instant expense categorization and data extraction powered by Google Gemini 1.5 Flash.
- **Local-First:** All data stays on your device using `expo-sqlite`. No cloud sync required.
- **Beautiful Typography:** Uses Google Fonts (Noto Serif & Manrope) for a premium reading experience.
- **Native Performance:** Fully optimized for both iOS and Android with equal parity.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [EAS CLI](https://docs.expo.dev/build/setup/) (for builds)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/kingonuoha/PeachSpend.git
   ```

2. Navigate to the app directory:
   ```bash
   cd app
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the development server:
   ```bash
   npx expo start
   ```

## Tech Stack

- **Framework:** Expo SDK 52 (React Native)
- **Navigation:** Expo Router v4
- **Styling:** NativeWind (Tailwind CSS) + Luminous Noir Tokens
- **Database:** `expo-sqlite`
- **AI:** Google Gemini 1.5 Flash
- **Icons:** Lucide React Native

## Expo Go runtime boundary

`app/utils/runtimeEnvironment.ts` is shared runtime policy. It identifies Expo Go
with `Constants.appOwnership` or `Constants.executionEnvironment`, then emits one
development-only `RuntimeGuard` notice per gated module. Expo Go skips
`expo-background-task` task definition and registration, does not mount the
`expo-share-intent` listener, and does not load or schedule `expo-notifications`.
Recurring foreground checks, local data, and supported `expo-local-authentication`
calls remain available. Custom development clients and production builds pass the
guard unchanged. Auto-capture remains visibly unavailable because no approved
native notification event source exists, and notification controls remain off
when Expo Go cannot schedule notifications. The Settings Alerts switch is disabled
and shown off there, even if enabled preference remains persisted for custom
development clients and production builds.

Verification: from `app/`, run `npm run typecheck`, `npm run lint`, and focused
runtime tests when changing this boundary. Do not run `expo prebuild` for Expo Go
compatibility work.

## Optional Android auto-capture module

`expo-auto-capture` is included through the local `file:./modules/expo-auto-capture`
dependency and is Android-only. The config plugin declares only the
`NotificationListenerService` binding permission on its service. Expo Go and iOS
use the optional-module fallback and remain inactive. Android listener behavior
requires `npm run build:development`, followed by `npm run dev`; Expo Go cannot
verify merged Android manifests or listener delivery.

## Design Guidelines

The app follows the **Luminous Noir** design system. Key principles:
- **Depth:** Use glassmorphism and subtle gradients instead of solid borders.
- **Contrast:** High-contrast text on deep surface containers.
- **Color:** Peach accents (`#FF8C69`) for interactive elements.

## License

MIT License - see [LICENSE](LICENSE) for details.
