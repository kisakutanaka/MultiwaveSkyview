import {
  DeviceOrientationTracker,
  isDeviceOrientationSupported,
  requestDeviceOrientationPermission,
  type DeviceOrientationDebugInfo,
} from "../sensors/deviceOrientation";

/**
 * Isolated azimuth/altitude sanity check: no geolocation, no astro pipeline,
 * no camera - just "which compass direction + elevation does the sensor say
 * the device is facing right now". Exists to answer one narrow question
 * before trusting any of the downstream sky-lock math: is
 * sensors/deviceOrientation.ts's own alpha/heading resolution correct in
 * isolation? Point the phone at a known direction/elevation (e.g. compare
 * against a known compass app, or flat/vertical/overhead) and check this
 * readout agrees.
 */

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function cardinalFor(azDeg: number): string {
  const index = Math.round(azDeg / 22.5) % 16;
  return CARDINALS[(index + 16) % 16]!;
}

function fmt(n: number | null): string {
  return n === null ? "-" : n.toFixed(0);
}

export function createHeadingCheckPanel(): HTMLDivElement {
  const container = document.createElement("div");
  container.id = "heading-check-panel";

  if (!isDeviceOrientationSupported()) {
    container.classList.add("hidden");
    return container;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "方位チェック開始";

  const bigHeading = document.createElement("div");
  bigHeading.className = "heading-big";
  bigHeading.classList.add("hidden");

  const bigAltitude = document.createElement("div");
  bigAltitude.className = "heading-big heading-big-secondary";
  bigAltitude.classList.add("hidden");

  const detail = document.createElement("div");
  detail.className = "heading-detail";
  detail.classList.add("hidden");

  container.appendChild(button);
  container.appendChild(bigHeading);
  container.appendChild(bigAltitude);
  container.appendChild(detail);

  const tracker = new DeviceOrientationTracker();
  let active = false;

  button.addEventListener("click", () => {
    void (async () => {
      if (active) {
        tracker.stop();
        active = false;
        button.textContent = "方位チェック開始";
        bigHeading.classList.add("hidden");
        bigAltitude.classList.add("hidden");
        detail.classList.add("hidden");
        return;
      }

      const granted = await requestDeviceOrientationPermission();
      if (!granted) {
        detail.textContent = "権限が許可されませんでした";
        detail.classList.remove("hidden");
        return;
      }

      active = true;
      button.textContent = "方位チェック停止";
      bigHeading.classList.remove("hidden");
      bigAltitude.classList.remove("hidden");
      detail.classList.remove("hidden");

      tracker.start(
        () => {
          /* not used here - only the raw debug channel matters for this check */
        },
        (info: DeviceOrientationDebugInfo) => {
          bigHeading.textContent = info.sample
            ? `方位 ${cardinalFor(info.sample.azDeg)} (${info.sample.azDeg.toFixed(0)}°)`
            : "計測不可 (値が棄却されました)";
          bigAltitude.textContent = info.sample ? `仰角 ${info.sample.altDeg.toFixed(0)}°` : "";

          detail.textContent =
            `webkitCompassHeading(raw): ${fmt(info.webkitCompassHeading)}° / ` +
            `alpha(raw): ${fmt(info.alphaRaw)}° / beta: ${fmt(info.betaRaw)}° / gamma: ${fmt(info.gammaRaw)}° / ` +
            `absolute: ${info.absolute} / screenAngleDeg: ${info.screenAngleDeg.toFixed(0)}° / ` +
            `rawAz: ${info.rawSample ? info.rawSample.azDeg.toFixed(1) : "-"}°`;
        },
      );
    })();
  });

  return container;
}
