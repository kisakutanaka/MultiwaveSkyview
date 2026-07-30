import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./style.css";

import { galacticToWorldDirection } from "./astro/galacticToDirection";
import { createAllColormapTextures } from "./data/colormaps";
import { loadAllSurveys } from "./data/loadAllSurveys";
import { SURVEYS } from "./data/surveys";
import { createTextureForSurvey } from "./data/textures";
import { SkyLayerMaterial } from "./gl/SkyLayerMaterial";
import { createSkySphere } from "./scene/createSkySphere";
import { isSkyLockSupported, SkyLockController } from "./skyLock";
import type { LayerState } from "./types";
import { createColormapPanel } from "./ui/colormapPanel";
import { createDebugToggle } from "./ui/debugToggle";
import { createHeadingCheckPanel } from "./ui/headingCheckPanel";
import { createLayerBar } from "./ui/layerBar";
import { createRingCheckButton } from "./ui/ringCheckButton";
import { createSensorDebugPanel } from "./ui/sensorDebugPanel";
import { createSkyLockButton } from "./ui/skyLockButton";
import { createUiVisibilityToggle } from "./ui/uiVisibilityToggle";

const appQuery = document.querySelector<HTMLDivElement>("#app");
if (!appQuery) {
  throw new Error("#app element not found");
}
const app: HTMLDivElement = appQuery;

const loadingOverlay = document.createElement("div");
loadingOverlay.id = "loading-overlay";
loadingOverlay.textContent = "サーベイを読み込み中...";
app.appendChild(loadingOverlay);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0, 0.01);

// Camera sits (almost) at the sphere's center; orbiting it around that
// center is what produces the "looking around from inside" feel.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = -0.3;
controls.update();

const material = new SkyLayerMaterial();
scene.add(createSkySphere(material));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Console/test hook for calibrating astro/galacticToDirection.ts against the
// sky sphere without needing real device sensors, e.g.:
//   __skyLockDebug.lookAtGalactic(0, 0)  // galactic center
// Persisted and re-applied every frame (below, in animate()) since
// OrbitControls.update() re-asserts its own orientation each frame even
// while `enabled` is false, which would otherwise stomp a one-shot lookAt.
let debugLookDirection: THREE.Vector3 | null = null;
(window as unknown as { __skyLockDebug: unknown }).__skyLockDebug = {
  lookAtGalactic: (lDeg: number, bDeg: number) => {
    controls.enabled = false;
    debugLookDirection = galacticToWorldDirection(lDeg, bDeg);
  },
  release: () => {
    debugLookDirection = null;
    controls.enabled = true;
  },
};

const skyLock = new SkyLockController(camera, controls);

// Small icon-button row (top-right): debug-tools toggle, sky-lock toggle,
// then the UI-hide toggle last so it stays visible even under .ui-hidden
// (see style.css) and can always be used to bring the UI back.
const topIconBar = document.createElement("div");
topIconBar.id = "top-icon-bar";
app.appendChild(topIconBar);

topIconBar.appendChild(createDebugToggle(app));

if (isSkyLockSupported()) {
  const skyLockButton = createSkyLockButton(() => {
    void (async () => {
      if (skyLock.isEnabled) {
        skyLock.disable();
        return;
      }
      skyLockButton.disabled = true;
      const granted = await skyLock.enable();
      skyLockButton.disabled = false;
      if (!granted) {
        console.warn("[sky-lock] permission denied or unavailable");
        skyLockButton.remove();
      }
    })();
  });
  topIconBar.appendChild(skyLockButton);

  const sensorDebugPanel = createSensorDebugPanel();
  app.appendChild(sensorDebugPanel.element);
  skyLock.onDebugUpdate = (info) => sensorDebugPanel.update(info);

  // Keeps the button state + sensor readout in sync even when skyLock
  // disables itself internally (e.g. the no-sample timeout), not just on
  // explicit clicks.
  skyLock.onStateChange = (enabled) => {
    skyLockButton.classList.toggle("active", enabled);
    skyLockButton.title = enabled ? "自由視点に戻る" : "実際の空と同期";
    skyLockButton.setAttribute("aria-label", skyLockButton.title);
    sensorDebugPanel.setEnabled(enabled);
  };
}

topIconBar.appendChild(createUiVisibilityToggle(app));

app.appendChild(createHeadingCheckPanel());
app.appendChild(createRingCheckButton(scene));

let lastFrameTimeMs = performance.now();

function animate(): void {
  requestAnimationFrame(animate);
  const nowMs = performance.now();
  const deltaSeconds = (nowMs - lastFrameTimeMs) / 1000;
  lastFrameTimeMs = nowMs;
  controls.update();
  skyLock.update(deltaSeconds);
  if (debugLookDirection) {
    camera.lookAt(debugLookDirection);
  }
  renderer.render(scene, camera);
}

async function main(): Promise<void> {
  const loadedSurveys = await loadAllSurveys((progress) => {
    loadingOverlay.textContent = `読み込み中 (${progress.surveyIndex + 1}/${progress.surveyCount}): ${progress.name}`;
  });

  const colormaps = createAllColormapTextures();
  const colormapNames = Object.keys(colormaps);
  const slotTextures: Record<"A" | "B", THREE.Texture | null> = { A: null, B: null };

  function applyLayer(slot: "A" | "B", state: LayerState): void {
    const survey = loadedSurveys.get(state.surveyName);
    if (!survey) {
      console.warn(`[layer ${slot}] survey not loaded (skipped or failed to fetch): ${state.surveyName}`);
      return;
    }

    const previousTexture = slotTextures[slot];
    const texture = createTextureForSurvey(survey);
    slotTextures[slot] = texture;
    // Dispose the outgoing GPU texture immediately: only two sky textures
    // are meant to be resident on the GPU at once.
    previousTexture?.dispose();

    const colormap = colormaps[state.colormap] ?? colormaps.grayscale!;

    material.setLayer(slot, { texture, colormap, kind: survey.config.kind });
  }

  const layerStateA: LayerState = {
    surveyName: "00_radio_haslam_408mhz",
    colormap: "inferno",
  };

  const layerStateB: LayerState = {
    surveyName: "02_visible_gaia_dr3_density",
    colormap: "viridis",
  };

  applyLayer("A", layerStateA);
  applyLayer("B", layerStateB);

  // Dev-only colormap picker (hidden by default, see #debug-toggle-button) -
  // the exhibit UI itself only exposes survey choice + blend, via layerBar.
  const colormapPanel = createColormapPanel({
    surveys: SURVEYS,
    colormapNames,
    initialLayerA: layerStateA,
    initialLayerB: layerStateB,
    onColormapChange: (slot, colormap) => {
      const state = slot === "A" ? layerStateA : layerStateB;
      state.colormap = colormap;
      applyLayer(slot, state);
    },
  });
  app.appendChild(colormapPanel.element);

  const layerBar = createLayerBar({
    surveys: SURVEYS,
    initialLayerA: layerStateA,
    initialLayerB: layerStateB,
    initialBlend: 0,
    onSurveyChange: (slot, surveyName) => {
      const state = slot === "A" ? layerStateA : layerStateB;
      state.surveyName = surveyName;
      applyLayer(slot, state);
      colormapPanel.setSurvey(slot, surveyName);
    },
    onBlendChange: (value) => material.setBlend(value),
  });
  app.appendChild(layerBar);

  loadingOverlay.classList.add("hidden");
}

animate();
main().catch((err: unknown) => {
  console.error(err);
  loadingOverlay.textContent = `読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`;
});
