// Pure motion invariants; no browser, server or paid APIs required.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const file = path.join(__dirname, '../src/components/marketing/mascot-animation.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleValue = { exports: {} };
new Function('require', 'exports', 'module', code)((name) => {
  assert.equal(name, '@/lib/ui-diagnostics');
  return { reportUiState() {} };
}, moduleValue.exports, moduleValue);
const { MASCOT_SCENES, AUTO_SCENES, mascotPose, sceneDuration, sceneGap, cycleScene, mascotGaze } = moduleValue.exports;
let samples = 0;
for (const scene of MASCOT_SCENES) {
  const duration = sceneDuration(scene);
  for (let elapsed = 0; elapsed <= duration; elapsed += 35) {
    const pose = mascotPose(scene, elapsed, duration, elapsed);
    assert.ok(Object.values(pose).every(Number.isFinite), scene + ': finite transforms');
    for (const key of ['eyeL', 'eyeR']) assert.ok(pose[key] >= .015 && pose[key] <= 1.1, scene + ': eye bounds');
    for (const key of ['book', 'laptop', 'cup', 'page', 'speech', 'sleep', 'scan']) {
      assert.ok(pose[key] >= 0 && pose[key] <= 1, scene + ': ' + key);
    }
    samples++;
  }
}
for (let time = 0; time < 8400; time += 50) {
  assert.ok(Math.abs(mascotPose('idle', time, 3800, time).left) < 3, 'Resting arm stays lowered');
}
for (const [scene, eye] of [['winkLeft', 'eyeL'], ['winkRight', 'eyeR']]) {
  const closed = mascotPose(scene, 810, sceneDuration(scene), 810);
  assert.ok(closed[eye] < .1, scene + ': closes');
  assert.equal(closed[eye === 'eyeL' ? 'eyeR' : 'eyeL'], 1, scene + ': other eye stays open');
  assert.equal(mascotPose(scene, 1400, sceneDuration(scene), 1400)[eye], 1, scene + ': reopens');
}
assert.ok(mascotPose('blink', 740, 2100, 740).eyeL < .1, 'Blink closes');
assert.equal(mascotPose('blink', 1100, 2100, 1100).eyeL, 1, 'Blink reopens');
const cycleLength = AUTO_SCENES.reduce((sum, scene) => sum + sceneDuration(scene) + sceneGap(scene), 0);
const reached = new Set();
for (let time = 0; time < cycleLength; time += 20) {
  const frame = cycleScene(time);
  if (frame.scene !== 'idle') reached.add(frame.scene);
}
assert.deepEqual([...reached], [...AUTO_SCENES], 'Every automatic gesture is reachable in order');
assert.equal(cycleScene(cycleLength).scene, AUTO_SCENES[0], 'Cycle loops cleanly');
console.log(`Mascot checks passed: ${MASCOT_SCENES.length} scenes, ${samples} poses, ${reached.size} automatic gestures.`);

const bounds = { left: 100, top: 120, width: 96, height: 100 };
const eyeX = bounds.left + bounds.width * 328 / 627;
const eyeY = bounds.top + bounds.height * 260 / 650;
for (const dx of [-10000, -500, 0, 500, 10000]) {
  for (const dy of [-10000, -500, 0, 500, 10000]) {
    const gaze = mascotGaze(eyeX + dx, eyeY + dy, bounds);
    assert.ok(Object.values(gaze).every(Number.isFinite), 'Finite pointer gaze');
    assert.ok((gaze.x / 9) ** 2 + (gaze.y / 6) ** 2 <= 1.00001, 'Pupils stay inside the gaze cone');
    assert.ok(Math.abs(gaze.leanX) <= 1 && Math.abs(gaze.leanY) <= 1, 'Bounded depth tilt');
  }
}
assert.ok(mascotGaze(eyeX - 500, eyeY, bounds).x < 0, 'Looks left');
assert.ok(mascotGaze(eyeX + 500, eyeY, bounds).x > 0, 'Looks right');
assert.ok(mascotGaze(eyeX, eyeY - 500, bounds).y < 0, 'Looks up');
assert.ok(mascotGaze(eyeX, eyeY + 500, bounds).y > 0, 'Looks down');
assert.deepEqual(mascotGaze(eyeX, eyeY, bounds), { x: 0, y: 0, leanX: 0, leanY: 0 });
assert.deepEqual(mascotGaze(NaN, 10, bounds), { x: 0, y: 0, leanX: 0, leanY: 0 });
assert.deepEqual(mascotGaze(10, 10, { ...bounds, width: 0 }), { x: 0, y: 0, leanX: 0, leanY: 0 });
console.log('Pointer gaze checks passed: directions, neutral return, eye bounds and invalid inputs.');
