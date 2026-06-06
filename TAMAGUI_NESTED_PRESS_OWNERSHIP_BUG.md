# Tamagui: a `Sheet.Frame` with `onPress` steals the press from buttons inside it (`pressEvents: true`)

This repo reproduces a bug in `tamagui@2.1.0`: with `setupGestureHandler({ pressEvents: true })` (the RNGH press path), a Tamagui pressable that **wraps** another Tamagui pressable can steal the press. Here a `Sheet.Frame` with `onPress`/`onPressIn` wraps a `Button` (`styled(View)` with `onPress`) inside the sheet: tapping the inner button can fire the **frame's** `onPress` instead of the button's, so the button's own `onPress` does not run. It is a **mount-time race**: in a given app session the bug is either fully present (the button is stolen on **every** tap) or fully absent (it works on every tap) - reloading the app re-rolls it (see "Why it's intermittent").

This is the opposite of what the code says it does. `@tamagui/native/src/gestureState.ts:113-116`:

```
Global press coordination - ensures only innermost pressable fires press events,
matching RN Pressable/responder system semantics where deepest component wins.
... since RNGH fires parent gestures before child gestures.
```

## Reproduction

`setupGestureHandler({ pressEvents: true, sheet: true })` runs in the root layout before `<TamaguiProvider>` mounts. See [`src/app/_layout.tsx`](src/app/_layout.tsx) and [`src/app/index.tsx`](src/app/index.tsx). The essential structure:

```tsx
// src/app/_layout.tsx
import { setupGestureHandler } from '@tamagui/native/setup-gesture-handler'
setupGestureHandler({ pressEvents: true, sheet: true })
// <GestureHandlerRootView> <TamaguiProvider> <Stack/> ...
```

```tsx
// src/app/index.tsx
const Button = styled(View, { /* ...size, pressStyle... */ })

<Sheet open={open} onOpenChange={...} snapPoints={[70]} snapPointsMode="percent" dismissOnSnapToBottom dismissOnOverlayPress>
  <Sheet.Overlay ... />
  <Sheet.Frame
    onPressIn={() => console.log('Frame pressed in')}
    onPress={() => console.log('Frame pressed')}
  >
    <Sheet.ScrollView>
      <SheetContainer>
        <Button onPress={() => console.log('Inner button pressed')}>
          <Text>Press me</Text>
        </Button>
      </SheetContainer>
    </Sheet.ScrollView>
  </Sheet.Frame>
</Sheet>
```

Steps: tap **Open sheet**, then tap the **Press me** button inside the sheet.

## Actual behavior

When the bug is present in a session, **every** tap on the inner button logs `Frame pressed` (and `Frame pressed in`) and `Inner button pressed` never fires - re-tapping does not help. The state is fixed for the whole session: reload the app and it may instead work on every tap. See "Why it's intermittent" below.

## Expected behavior

Tapping the inner button always logs `Inner button pressed`. The innermost pressable should win, matching the RN responder system and Tamagui's own stated intent. Tapping the frame *outside* the button logs `Frame pressed`.

## Why it's intermittent (a mount-time race)

The bug is **all-or-nothing per app session**, not per tap. Within one mount the inner button is either stolen on **every** tap or works on **every** tap - re-tapping never changes it; you have to **reload the app** to re-roll. So the race is at gesture setup (mount) time, not a per-tap timing race.

Each Tamagui press is a `Gesture.Tap()` (`gestureState.ts:321`). On `onBegin` it claims a single shared global owner via `tryClaimOwnership`; the reclaim rule (`:266-267`) has **no tie-breaker**, so the owner is simply whichever of the two nested gestures (frame, button) runs its `onBegin` **last**, and `onEnd` (`:356-359`) fires `onPress` only for that owner. Ownership is released on every finalize (`onFinalize` -> `releaseOwnership`, `:362-365`, `:280-288`), so **each tap re-runs the claim from scratch** - yet within a session the *same* gesture wins every time. That can only mean the `onBegin` order of the two gestures is itself fixed for the session: established at gesture setup (mount) and re-rolled only on reload (gesture handler identities are assigned at creation, `getNextHandlerTag`). The code even hard-codes the assumption that this order is "parent before child" (`:248`) and adds a 24ms grace window (`:251`) so the child can reclaim: sessions that mount in that order work, sessions that mount in the opposite order steal on every tap.

So with no tie-breaker, which press wins comes down entirely to an ordering that isn't guaranteed. The depth-aware fix removes that dependence: ownership is decided by nesting depth, so the innermost wins on every tap in every session, regardless of registration order.

## Impact

This is not specific to the Sheet - it affects any nested Tamagui press pair under `pressEvents: true`. The same defect makes a tappable card swallow taps on its own "..." menu button. The `Sheet.Frame` case is just the clearest reproduction.

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

For two nested Tamagui press gestures (the `Sheet.Frame` and the `Button`, each in its own `GestureDetector`), that assumption is inverted: the **ancestor** (frame) reclaims last, so it becomes the owner. The button's `onEnd` then sees `isOwner() === false` and its `onPress` never runs.

Net: the documented "innermost/deepest wins" becomes "outermost wins" for nested presses.

## Suggested fix (tested, works - may not be the most elegant)

Make ownership **depth-aware**: a deeper (more deeply nested) press gesture may reclaim from a shallower one, but **never** the reverse. This makes "deepest wins" hold regardless of `onBegin` delivery order, so it no longer depends on the incorrect "parent fires first" assumption.

- `pressState` gains an `ownerDepth`; the reclaim condition adds `&& depth > pressState.ownerDepth`, and sets `ownerDepth` on claim (`@tamagui/native`).
- Each press gesture receives its nesting depth, supplied via a React context that increments **only on components that attach a real press gesture** (`hasRealPressEvents`), so decorative non-pressable views never inflate depth (`@tamagui/web`: `createComponent` provides the context, `eventHandling.native` relays the depth into `createPressGesture`).

Full patch (two files):

- `patches/@tamagui+native+2.1.0.patch` - the ownership rule (`gestureState`).
- `patches/@tamagui+web+2.1.0.patch` - the depth plumbing (`createComponent` + `eventHandling.native`).

Tested with `pressEvents: true`: with the patch applied, tapping the inner button fires the button's `onPress` and the frame no longer steals it. It also fixes a real app where a tappable card was swallowing taps on its own "..." menu button. Because ownership is decided by depth rather than `onBegin` arrival order, the inner button wins in every session, regardless of how the gestures registered at mount.

## Notes

- Platforms: native only (`pressEvents: true`). Web is unaffected - Tamagui maps web presses to `onClick`, which bubbles normally; the `pressState` ownership path is native-only. The steal happens because the ancestor's press gesture reclaims ownership **last** (its `onBegin` runs after the descendant's) - the opposite of what the code assumes at line 248 ("RNGH fires parent before child"). Whether a given platform/RNGH version delivers nested `onBegin` in that order is what determines if the steal is visible; the depth-aware fix removes that dependency entirely.
- Dev gotcha: the per-component press state latches (`hasHadEvents` / `gestureRef` never reset in `@tamagui/web/src/eventHandling.native.ts`), so removing an `onPress` and Fast-Refreshing does not clear the stale gesture - a full reload is required to see the effect of adding/removing a handler.
