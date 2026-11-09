# Website experience requirements

These requirements record the confirmed direction for <https://bot.cloudentropy.ai/>. Read this file before changing the website or its `scripts/testing/site-*` entries. Chinese and English refer to the same experience and conversation state.

- Keep the complete, interactive product workspace on the homepage. Reuse the real App, components, styles and avatars. Visitors can switch assistants, enter text, send it and receive a new reply. Videos, static screenshots or hand-drawn mock interfaces do not replace this workspace.
- The sample conversation starts automatically, streams assistant text and repeats after completion. Refreshing an untouched example and returning from a hidden tab must restore playback. User input or assistant selection takes control; offer explicit pause/repeat controls and preserve user conversations. Respect reduced motion.
- Keep Chinese / EN controls visible on desktop and mobile. Translate marketing copy, accessibility labels, product UI, feature examples and preset replies. Switching languages preserves assistant/thread/message IDs, submitted messages and unsent drafts. Translate only known seed content, never user turns.
- The Chinese hero description separates the two sentences: “可以交付真实工作的 AI 助手。” followed by “整理你的资料，记住你的偏好，推进任务，做完再回来找你。” On narrow screens, the second sentence may wrap naturally.
- Keep the title mascot proportional to the text, without a black square background. Use Entropybot's native SVG face and body animation, including blinks, gaze and restrained expressions. A PNG with CSS rotation or floating is insufficient. Keep Entropybot's own silhouette and identity.
- Eyes must remain small and proportional throughout the animation, including transitions. Avoid the native renderer's exaggerated round-eye expressions in the hero. The current explicit sequence uses expression IDs 13 / 6 / 0 / 6 / 15, disables random expression selection and uses `eyeScale=0.95`. Natural blinks, pointer gaze and body motion remain enabled.
- Feature examples follow tool use, reusable steps, preference correction and assistant collaboration. Reuse native components; keep user controls usable, pause offscreen and show complete results for reduced motion.
- Label synthetic data and preset replies honestly. This website connects no real model, account, personal memory or external task engine. Browser-local sample state does not authorize broader API access.
- Keep `/demo/` as a compatibility path. Do not add a separate demo CTA in place of the homepage workspace. The existing domain and deployment remain authoritative.
- Retain the public release/signing status accurately. A website demonstration of candidate UI does not publish a desktop release.

## Implementation and verification notes

The static build combines `site/`, the real product App and isolated browser adapters under `scripts/testing/`. Session data is stored in the visitor's tab. The adapter allows bounded text chat and conversation navigation; it rejects unrelated API operations. Keep origin/source/session/request-ID checks on iframe messages.

Autoplay completion and user takeover are separate states. Stopping must be idempotent, and new-conversation/selection/send API routes stop playback even when reached by keyboard. Restoration limits must cover the maximum legal seeded conversation plus user turns. Replay preserves user threads.

Hero stage timing derives from elapsed time, so returning to the viewport uses the current phase instead of restarting a full stage. Pause native rendering offscreen or when the page is hidden. Keep a static SVG from the same native character as a fallback when its module cannot load. Do not import product-wide CSS into the homepage's independent hero entry.

Verify live DOM changes and actual input/replies, not just component mounting, file existence or screenshots. Check complete loops and the maximum eye dimensions across all stages; one idle screenshot misses oversized expressions. Wait for title entrance animations to finish before measuring geometry. Headless native input needs an active page (`Page.bringToFront`) as well as the correct textarea focus.

Use synthetic data and isolated browser profiles. Record local checks separately from public verification. Chromium viewport emulation does not establish Safari, Firefox or physical mobile keyboard support. Keep machine paths, credentials and deployment inventories out of public documentation.
