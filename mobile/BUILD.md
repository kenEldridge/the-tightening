# Building the iOS app (for the Mac + Xcode collaborator)

You are the only person on this project with a Mac and an Apple Developer
account. Development happens on Windows; everything you need is committed.
**Before you build anything, check that the "iOS CI" GitHub Action is green on
the commit you checked out** — your build should be a re-run of something
already proven, never a first attempt.

## One-time machine setup

- Xcode 26 or newer (React Native 0.86 requires Swift tools 6.2 — older Xcode
  fails with "package 'apple' is using Swift tools version 6.2.0")
- Node 20 — `nvm install 20 && nvm use 20` (an `.nvmrc` is in this directory)
- CocoaPods — `sudo gem install cocoapods` (or `brew install cocoapods`)

## Build steps (every time, identical)

```sh
git clone https://github.com/kenEldridge/the-tightening.git
cd the-tightening/mobile
nvm use
npm ci
npx expo prebuild -p ios     # generates ios/ from app.json + runs pod install
open ios/*.xcworkspace       # ALWAYS the .xcworkspace, never the .xcodeproj
```

In Xcode:

1. Select the app target → **Signing & Capabilities** → pick your team.
   The bundle ID is `com.keneldridge.the-tightening` (set in `app.json`).
2. **Product → Archive**, then **Distribute App**.

## The two builds you'll be asked for

**1. Early development-client build (once, near the start).** This app includes
`expo-dev-client`, so the archive you produce doubles as Ken's development
shell: he installs it once, then loads all day-to-day JS changes from his
Windows PC over Wi-Fi — you won't be needed again until release, unless native
dependencies change (they're deliberately all batched into this build).
Distribute via **TestFlight internal testing**: upload the archive to App Store
Connect, add Ken (eldridge.kenneth@gmail.com) as an internal tester.

**2. Release build (at the end).** Same steps, distribute to TestFlight /
App Store as agreed.

## Rules that keep this working first-try

- **Never edit anything under `ios/`.** It's generated and gitignored;
  `npx expo prebuild -p ios --clean` recreates it from scratch. All native
  config (bundle ID, permissions, icons) lives in `app.json` and
  `modules/midi-ble-pairing/`.
- Dependency versions are pinned by `package-lock.json` — always `npm ci`,
  never `npm install`.
- If pods act up: `npx expo prebuild -p ios --clean` (regenerates + reinstalls).

## What this app contains natively

- `@motiz88/react-native-midi` — CoreMIDI via the Expo Modules API (Web MIDI
  API shape)
- `modules/midi-ble-pairing/` — local Expo module presenting the system
  Bluetooth-MIDI pairing sheet (`CABTMIDICentralViewController`)
- `react-native-svg`, `expo-keep-awake`, AsyncStorage, `expo-dev-client`
