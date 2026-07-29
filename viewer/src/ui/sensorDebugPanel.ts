import type { DeviceOrientationDebugInfo } from "../sensors/deviceOrientation";

/**
 * Live readout of raw DeviceOrientationEvent values, visible on-device.
 * Exists because sky-lock bugs only reproduce on real phones (no remote
 * debugger attached in the field), so console.warn alone isn't enough to
 * diagnose them - this makes what the sensor is actually reporting visible
 * directly on screen.
 */
export interface SensorDebugPanel {
  element: HTMLDivElement;
  setEnabled: (enabled: boolean) => void;
  update: (info: DeviceOrientationDebugInfo) => void;
}

function row(label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
  const r = document.createElement("div");
  r.className = "row";
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("span");
  v.textContent = "-";
  r.appendChild(l);
  r.appendChild(v);
  return { row: r, value: v };
}

function fmt(n: number | null): string {
  return n === null ? "null" : n.toFixed(1);
}

export function createSensorDebugPanel(): SensorDebugPanel {
  const element = document.createElement("div");
  element.id = "sensor-debug-panel";

  const status = row("sky-lock:");
  const eventType = row("event:");
  const alphaRaw = row("alpha(raw):");
  const betaRaw = row("beta:");
  const gammaRaw = row("gamma:");
  const absolute = row("absolute:");
  const compass = row("webkitCompassHeading:");
  const resolved = row("resolvedAlpha:");
  const screenAngle = row("screenAngleDeg:");
  const rawSample = row("rawSample(alt/az):");
  const sample = row("sample(alt/az):");

  for (const r of [status, eventType, alphaRaw, betaRaw, gammaRaw, absolute, compass, resolved, screenAngle, rawSample, sample]) {
    element.appendChild(r.row);
  }

  function clearFields(): void {
    for (const v of [eventType, alphaRaw, betaRaw, gammaRaw, absolute, compass, resolved, screenAngle, rawSample, sample]) {
      v.value.textContent = "-";
    }
  }

  return {
    element,
    setEnabled(enabled: boolean) {
      status.value.textContent = enabled ? "ON" : "OFF";
      if (!enabled) {
        clearFields();
      }
    },
    update(info: DeviceOrientationDebugInfo) {
      eventType.value.textContent = info.eventType;
      alphaRaw.value.textContent = fmt(info.alphaRaw);
      betaRaw.value.textContent = fmt(info.betaRaw);
      gammaRaw.value.textContent = fmt(info.gammaRaw);
      absolute.value.textContent = String(info.absolute);
      compass.value.textContent = fmt(info.webkitCompassHeading);
      resolved.value.textContent = info.resolvedAlphaDeg === null ? "null (REJECTED)" : fmt(info.resolvedAlphaDeg);
      screenAngle.value.textContent = info.screenAngleDeg.toFixed(0);
      rawSample.value.textContent = info.rawSample ? `${info.rawSample.altDeg.toFixed(1)} / ${info.rawSample.azDeg.toFixed(1)}` : "none";
      sample.value.textContent = info.sample ? `${info.sample.altDeg.toFixed(1)} / ${info.sample.azDeg.toFixed(1)}` : "none";
    },
  };
}
