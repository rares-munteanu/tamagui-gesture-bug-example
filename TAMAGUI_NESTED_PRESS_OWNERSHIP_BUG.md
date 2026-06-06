# Tamagui: a parent press steals the press from a nested child (`pressEvents: true` RNGH path)

This repo reproduces a bug in `tamagui@2.1.0`: with `setupGestureHandler({ pressEvents: true })` (the RNGH press path, the default on native), a Tamagui pressable that **wraps** another Tamagui pressable steals the press. Tapping the inner (descendant) pressable fires the **outer** (ancestor)'s `onPress`; the inner's `onPress` never runs.

This is the exact opposite of what the code says it does. `@tamagui/native/src/gestureState.ts:113-116`:

```
Global press coordination - ensures only innermost pressable fires press events,
matching RN Pressable/responder system semantics where deepest component wins.
... since RNGH fires parent gestures before child gestures.
```

## Reproduction

Minimal - two nested `styled(View)` pressables, no Sheet required.

```tsx
// src/app/_layout.tsx  (runs before <TamaguiProvider> mounts)
import { setupGestureHandler } from '@tamagui/native/setup-gesture-handler'
setupGestureHandler({ pressEvents: true })
```

```tsx
// src/app/index.tsx
import { styled, Text, View } from 'tamagui'

const Box = styled(View, { padding: 24 })

export default function Index() {
  return (
    <Box onPress={() => console.log('OUTER pressed')}>
      <Box onPress={() => console.log('INNER pressed')}>
        <Text>tap me</Text>
      </Box>
    </Box>
  )
}
```

Tap the inner box (over "tap me").

## Actual behavior

Console logs `OUTER pressed`. The inner box's `onPress` never fires - the ancestor stole the press.

## Expected behavior

Console logs `INNER pressed`. The innermost pressable should win (matching the RN responder system, and Tamagui's own stated intent). Tapping the outer box *outside* the inner box should fire `OUTER pressed`.

The same defect makes a `Sheet.Frame` with `onPress`/`onPressIn` swallow taps on any button inside the sheet, and a tappable card swallow taps on its own "..." menu button. It is not Sheet- or card-specific: any nested Tamagui press pair under `pressEvents: true` hits it.

## Why this is a Tamagui issue, not an RNGH one

Tamagui does not let RNGH arbitrate these presses. Each Tamagui press is a `Gesture.Tap()` whose `onPress` only fires if it owns a single module-global `pressState`. RNGH behaves as documented (no bubbling; handlers race). Tamagui layers its own coordination on top to emulate the responder system's "innermost wins", and that layer is where the bug is. The RNGH relation APIs (`requireExternalGestureToFail` / `blocksExternalGesture`) cannot fix it from app code: they gate gesture *activation*, but the steal is decided earlier, in `onBegin` ownership, and Tamagui does not expose the internal gesture objects to relate them.

## Root cause (from the published 2.1.0 source)

All in `@tamagui/native/src/gestureState.ts`:

1. Each Tamagui press is a `Gesture.Tap()` that claims the global `pressState` in `onBegin` via `tryClaimOwnership` (line 255), and only fires `config.onPress` in `onEnd` if it still owns it (`onEnd` at line 356, `config.onPress?.(e)` at line 359, gated by `isOwner()` at line 278).

2. The reclaim rule (lines 266-267):

```ts
if (
  pressState.owner === null ||
  (pressState.ownerSource === 'internal' && isSameTouchPointer)
) {
  // ... pressState.owner = myToken; pressState.ownerSource = 'internal' (line 271)
}
```

Any internal gesture on the same finger may **overwrite** the current internal owner. So the press winner is simply whichever nested gesture calls `tryClaimOwnership` **last**.

3. The code assumes that last caller is the child. Comment at line 248:

```
// RNGH fires parent before child, but we want innermost to win.
```

For two nested Tamagui press gestures (each in its own `GestureDetector`), that assumption is inverted: the **ancestor** reclaims last, so it becomes the owner. The descendant's `onEnd` then sees `isOwner() === false` and its `onPress` never runs.

Net: the documented "innermost/deepest wins" becomes "outermost wins" for nested presses.

## Suggested fix (tested, works - may not be the most elegant)

Make ownership **depth-aware**: a deeper (more deeply nested) press gesture may reclaim from a shallower one, but **never** the reverse. This makes "deepest wins" hold regardless of `onBegin` delivery order, so it no longer depends on the incorrect "parent fires first" assumption.

- `pressState` gains an `ownerDepth`; the reclaim condition adds `&& depth > pressState.ownerDepth`, and sets `ownerDepth` on claim (`@tamagui/native`).
- Each press gesture receives its nesting depth, supplied via a React context that increments **only on components that attach a real press gesture** (`hasRealPressEvents`), so decorative non-pressable views never inflate depth (`@tamagui/web`: `createComponent` provides the context, `eventHandling.native` relays the depth into `createPressGesture`).

Full patch (two files):

- `patches/@tamagui+native+2.1.0.patch` - the ownership rule (`gestureState`).
- `patches/@tamagui+web+2.1.0.patch` - the depth plumbing (`createComponent` + `eventHandling.native`).

A one-line "first claim wins" variant (drop the same-pointer reclaim entirely) was rejected: it only equals innermost-wins if RNGH delivers the child's `onBegin` first, which is exactly the assumption that is already wrong here, so it is order-dependent and risks regressing the intended child-steals-parent case. The depth approach is order-independent.

Verified on iOS and Android with `pressEvents: true`: tapping the inner pressable fires the inner `onPress`; tapping the outer (outside the inner) fires the outer; a single pressable is unchanged; a decorative non-press view between two pressables does not shift the winner.

## Notes

- Platforms: native (iOS + Android). Web is unaffected - Tamagui maps web presses to `onClick`, which bubbles normally; the `pressState` ownership path is native-only.
- Dev gotcha: the per-component press state latches (`hasHadEvents` / `gestureRef` never reset in `@tamagui/web/src/eventHandling.native.ts`), so removing an `onPress` and Fast-Refreshing does not clear the stale gesture - a full reload is required to see the effect of adding/removing a handler.
