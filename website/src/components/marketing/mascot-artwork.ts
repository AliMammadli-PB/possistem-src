/** Original user-provided V3 artwork; only transparent margins and file encoding are optimized. */
export const MASCOT_ASSET_ROOT='/assets/support-mascot/v3-20261023';
export const MASCOT_ASSETS=['body','left','right'] as const;
/** A trusted, code-owned SVG template shared by React and the downloadable motion studio. */
export function mascotArtwork(prefix:string){
 const id=prefix.replace(/[^a-zA-Z0-9_-]/g,'');
 return `<defs>
 <radialGradient id="${id}-eye"><stop stop-color="#dcffff"/><stop offset=".6" stop-color="#69f6ff"/><stop offset="1" stop-color="#00bfff"/></radialGradient>
 <linearGradient id="${id}-paper" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#cce3ff"/></linearGradient>
 <linearGradient id="${id}-device" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#337aff"/><stop offset="1" stop-color="#082253"/></linearGradient>
 <radialGradient id="${id}-joint"><stop stop-color="#031d4c"/><stop offset=".55" stop-color="#163c76"/><stop offset=".82" stop-color="#cdeaff"/><stop offset="1" stop-color="#5278ac"/></radialGradient>
 <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <clipPath id="${id}-blinkL"><rect data-part="aperture-left" x="-32" y="-36" width="64" height="72"/></clipPath><clipPath id="${id}-blinkR"><rect data-part="aperture-right" x="-29" y="-31" width="58" height="62"/></clipPath>
 <clipPath id="${id}-eyeL"><ellipse rx="28" ry="36"/></clipPath><clipPath id="${id}-eyeR"><ellipse rx="25" ry="31"/></clipPath>
 <clipPath id="${id}-visor"><path d="M210 184Q307 149 407 201Q476 239 449 314Q429 355 321 343Q199 332 190 296Q172 233 210 184Z"/></clipPath>
 <mask id="${id}-bodyMask" maskUnits="userSpaceOnUse" x="0" y="0" width="627" height="650"><rect width="627" height="650" fill="white"/><path d="M140 308h15v0.6h-15ZM140 308.5h15.5v0.6h-15.5ZM140 309h16v0.6h-16ZM140 309.5h16.5v0.6h-16.5ZM140 310h17.5v0.6h-17.5ZM140 310.5h18v0.6h-18ZM140 311h18.5v0.6h-18.5ZM140 311.5h19v0.6h-19ZM140 312h20v0.6h-20ZM140 312.5h20.5v0.6h-20.5ZM140 313h21.5v0.6h-21.5ZM140 313.5h22.5v0.6h-22.5ZM140 314h23.5v0.6h-23.5ZM140 314.5h24.5v0.6h-24.5ZM140 315h25.5v0.6h-25.5ZM140 315.5h27v0.6h-27ZM140 316h28v0.6h-28ZM140 316.5h29.5v0.6h-29.5ZM140 317h30v0.6h-30ZM140 317.5h30v0.6h-30ZM140 318h30v0.6h-30ZM140 318.5h30v0.6h-30ZM140 319h30v0.6h-30ZM140 319.5h30v0.6h-30ZM140 320h30v0.6h-30ZM140 320.5h30v0.6h-30ZM140 321h30v0.6h-30ZM140 321.5h30v0.6h-30ZM140 322h30v0.6h-30ZM140 322.5h30v0.6h-30ZM140 323h30v0.6h-30ZM140 323.5h30v0.6h-30ZM140 324h30v0.6h-30ZM140 324.5h30v0.6h-30ZM140 325h30v0.6h-30ZM140 325.5h30v0.6h-30ZM140 326h30v0.6h-30ZM140 326.5h30v0.6h-30ZM140 327h30v0.6h-30ZM140 327.5h30v0.6h-30ZM140 328h30v0.6h-30ZM140 328.5h30v0.6h-30ZM140 329h30v0.6h-30ZM140 329.5h30v0.6h-30ZM140 330h30v0.6h-30ZM140 330.5h30v0.6h-30ZM140 331h30v0.6h-30ZM140 331.5h30v0.6h-30ZM140 332h30v0.6h-30ZM140 332.5h30v0.6h-30ZM140 333h30v0.6h-30ZM140 333.5h30v0.6h-30ZM140 334h30v0.6h-30ZM140 334.5h30v0.6h-30ZM140 335h30v0.6h-30ZM140 335.5h30v0.6h-30ZM140 336h30v0.6h-30ZM140 336.5h30v0.6h-30ZM140 337h30v0.6h-30ZM140 337.5h30v0.6h-30ZM140 338h30v0.6h-30ZM140 338.5h30v0.6h-30ZM140 339h30v0.6h-30ZM140 339.5h30v0.6h-30ZM140 340h30v0.6h-30Z" fill="black"/></mask>
 </defs>
 <g data-part="placeholder"><path d="M195 210h230q25 0 25 25v120q0 25-25 25h-90l-65 48v-48h-75q-25 0-25-25V235q0-25 25-25Z" fill="#155ddd" stroke="#fff" stroke-width="8"/><path d="M230 275h160m-160 45h105" stroke="#fff" stroke-width="12" stroke-linecap="round"/></g>
 <g data-part="art" opacity="0">
 <ellipse data-part="shadow" cx="315" cy="620" rx="132" ry="10" fill="#1353a8" opacity=".14"/>
 <g data-part="rig">
 <ellipse cx="211" cy="394" rx="16" ry="17" fill="#0b2c5c"/>
 <ellipse cx="456" cy="432" rx="15" ry="17" fill="#0b2c5c"/>
 <image data-asset="body" data-src="${MASCOT_ASSET_ROOT}/robot-body-v3.webp" data-fallback="${MASCOT_ASSET_ROOT}/robot-body-v3.png" x="19.5" y="36.5" width="591.5" height="590.5" mask="url(#${id}-bodyMask)"/>
 <g data-part="cup" opacity="0"><path d="M-43-52h44l-3 50q-20 10-39-2Z" fill="#eff8ff" stroke="#73adf1" stroke-width="3"/><path d="M1-43q25 0 18 18q-4 10-19 8" fill="none" stroke="#9dcdff" stroke-width="6"/><path d="M-34-31h23" stroke="#2e8ee0" stroke-width="4"/><g data-part="steam" stroke="#9dd6f5" stroke-width="3" fill="none" stroke-linecap="round"><path d="M-29-61q-7-9 2-17m12 17q-7-9 2-17"/></g></g>
 <g data-part="left"><image data-asset="left" data-src="${MASCOT_ASSET_ROOT}/robot-left-v3.webp" data-fallback="${MASCOT_ASSET_ROOT}/robot-left-v3.png" x="59" y="288.5" width="138.5" height="158"/></g>
 <g data-part="right"><image data-asset="right" data-src="${MASCOT_ASSET_ROOT}/robot-right-v3.webp" data-fallback="${MASCOT_ASSET_ROOT}/robot-right-v3.png" x="442" y="398.5" width="124" height="154"/></g>
 <g clip-path="url(#${id}-visor)" filter="url(#${id}-glow)">
 <g transform="translate(262 252) rotate(7)"><g data-part="eye-left" clip-path="url(#${id}-blinkL)"><ellipse data-part="eye-white-left" rx="28" ry="36" fill="url(#${id}-eye)"/><g clip-path="url(#${id}-eyeL)"><g data-part="pupil-left"><ellipse cx="3" cy="3" rx="12" ry="27" fill="#081c54"/><ellipse cx="7" cy="-17" rx="5" ry="7" fill="#fff"/></g></g></g><path data-part="lid-left" d="M-25 0Q0-8 25 0" fill="none" stroke="#69f5ff" stroke-width="7" stroke-linecap="round" opacity="0"/></g>
 <g transform="translate(395 267) rotate(7)"><g data-part="eye-right" clip-path="url(#${id}-blinkR)"><ellipse data-part="eye-white-right" rx="25" ry="31" fill="url(#${id}-eye)"/><g clip-path="url(#${id}-eyeR)"><g data-part="pupil-right"><ellipse cx="2" cy="2" rx="11" ry="23" fill="#081c54"/><ellipse cx="6" cy="-14" rx="4.5" ry="6" fill="#fff"/></g></g></g><path data-part="lid-right" d="M-23 0Q0-7 23 0" fill="none" stroke="#69f5ff" stroke-width="7" stroke-linecap="round" opacity="0"/></g>
 <g data-part="brows" fill="none" stroke="#65dff2" stroke-width="3" opacity=".4" stroke-linecap="round"><path d="M240 204Q259 196 277 205M376 226Q394 219 412 232"/></g>
 <path data-part="mouth" d="M292 296Q315 309 338 296Q334 316 315 317Q299 317 292 296Z" fill="url(#${id}-eye)" stroke="#65f5ff" stroke-width="2" stroke-linejoin="round"/>
 <g data-part="cheeks" opacity="0" fill="#ff9cc4"><ellipse cx="220" cy="300" rx="14" ry="6"/><ellipse cx="438" cy="306" rx="13" ry="6"/></g>
 <g data-part="tears" opacity="0" fill="#69eeff"><path d="M224 284q-10 20 0 23q10-3 0-23Zm209 9q-9 18 0 21q10-3 0-21Z"/></g>
 <path data-part="scan" opacity="0" d="M199 286L448 299" stroke="#70f9ff" stroke-width="4"/>
 </g>
 <g data-part="book" opacity="0"><path d="M218 455Q267 440 314 468Q364 442 416 457L405 542Q360 524 314 549Q269 525 226 542Z" fill="url(#${id}-device)" stroke="#9de5ff" stroke-width="4"/><path d="M230 467Q280 452 312 478L312 539Q270 518 230 534Z" fill="url(#${id}-paper)"/><path d="M315 478Q363 452 401 468L399 535Q363 517 315 538Z" fill="#d5ebff"/><g data-part="page"><path d="M315 478Q363 452 401 468L399 535Q363 517 315 538Z" fill="url(#${id}-paper)"/><path data-part="page-text" d="M329 489l56-9m-54 22 56-7" stroke="#7faee5" stroke-width="3"/></g><path d="M314 472v74" stroke="#1a65c9" stroke-width="4"/><path d="m240 482 56 5m-57 9 52 6m-51 9 50 5" stroke="#7faee5" stroke-width="3"/></g>
 <g data-part="laptop" opacity="0"><path d="M240 410Q240 401 250 401H391Q400 401 400 413L392 505H250Z" fill="url(#${id}-device)" stroke="#9bd4ff" stroke-width="4"/><rect x="262" y="419" width="116" height="66" rx="7" fill="#071b3f"/><g stroke="#28e8fa" stroke-width="4" stroke-linecap="round"><path data-part="line-0" d="M277 435h40"/><path data-part="line-1" d="M277 448h77"/><path data-part="line-2" d="M277 462h50"/></g><path d="M240 504H401L424 520Q424 528 406 529H227Q213 526 222 520Z" fill="#bdddfa" stroke="#527bac" stroke-width="3"/><rect x="297" y="509" width="42" height="6" rx="3" fill="#609ad2"/></g>
 <g data-part="speech" opacity="0"><path d="M454 109h94q13 0 13 13v47q0 13-13 13h-32l-26 21v-21h-36q-13 0-13-13v-47q0-13 13-13Z" fill="#f1f8ff" stroke="#266bcd" stroke-width="4"/><circle data-part="dot-0" cx="469" cy="146" r="5" fill="#2472d6"/><circle data-part="dot-1" cx="501" cy="146" r="5" fill="#2472d6"/><circle data-part="dot-2" cx="533" cy="146" r="5" fill="#2472d6"/></g>
 <g data-part="sparkles" opacity="0" stroke="#6be5ff" stroke-width="6" stroke-linecap="round"><path d="M130 230v22m-11-11h22m338-74v24m-12-12h24"/></g>
 <g data-part="question" opacity="0" stroke="#42c9f5" stroke-width="6" stroke-linecap="round" fill="none"><path d="M477 212q0-19 17-19q20 0 20 16q0 12-17 18v9m0 12v1"/></g>
 <g data-part="heart" opacity="0"><path d="M478 208C448 178 465 161 480 181C493 155 518 179 478 208Z" fill="#ff86af"/></g>
 <g data-part="sleep" opacity="0" stroke="#65d9fa" fill="none" stroke-width="6" stroke-linejoin="round"><path d="M463 166h27l-27 28h27m14-68h19l-19 20h19"/></g>
 <g data-part="charge" opacity="0" fill="#7bffff"><path d="m309 416-22 39h24l-10 29 38-46h-24l14-22Z"/></g>
 </g></g>`;
}
