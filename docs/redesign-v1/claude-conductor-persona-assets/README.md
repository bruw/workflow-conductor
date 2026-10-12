# Claude Conductor persona assets

Four isolated animation keyframes from the selected Conductor TUI persona.

| State | PNG | Gesture |
| --- | --- | --- |
| Idle | 01-idle.png | Calm, attentive; baton low. |
| Ready | 02-ready.png | Baton raised to cue the start. |
| Conducting | 03-conducting.png | Downbeat with the other hand cueing. |
| Complete | 04-complete.png | Small acknowledging nod; baton lowered. |

All source PNGs are 1254 x 1254 with transparent alpha. Source PNG bytes are unchanged from the generated outputs.

conductor-sprite-sheet.png places the four frames in a 2 x 2 grid: idle and ready on the first row; conducting and complete on the second. Tile rectangles are in manifest.json.

conductor-animation-preview.gif cycles all four poses with illustrative timing (900 / 400 / 350 / 950 ms). It is a preview of the pose sequence; select the appropriate pose for each actual workflow state.

## Generation brief

Built-in image generation, using the approved Conductor TUI footer persona as the identity reference. Preserve the square terracotta head, chalk eye pixels, chalk collar, rectangular torso and limbs, and stepped baton. Isolate on transparent alpha. Keep consistent character scale and a shared body/feet position. No UI, text, labels, backgrounds or additional objects.

Idle: calm, upright, both feet planted, baton held low on the right.
Ready: right hand and baton raised diagonally; left hand near the chest.
Conducting: right arm extending for a downbeat, baton angled down-right, left hand cueing the ensemble.
Complete: tiny head nod, relaxed eye marks, baton lowered, modest open-palm acknowledgement.
