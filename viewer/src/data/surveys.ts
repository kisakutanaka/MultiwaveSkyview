import type { SurveyConfig } from "../types";

/**
 * TypeScript mirror of allsky_surveys.SURVEYS (Python).
 * Raw files are served from public/data, which is a symlink to
 * ../allsky_textures (see download_allsky_fits.py / convert_allsky_png.py).
 *
 * All surveys load pre-rendered PNGs (allsky_textures/png/), not raw FITS:
 * this keeps the deployed payload small enough to be hostable (a handful of
 * MB per survey instead of ~130MB), at the cost of losing interactive
 * stretch/percentile control - the stretch is baked in by convert_allsky_png.py.
 * The colormap LUT can still be swapped client-side for "scalar" surveys
 * since that only needs the already-stretched 0-255 gray value.
 */

// import.meta.env.BASE_URL matches vite.config.ts's `base` (e.g. "/" in dev,
// "/MultiwaveSkyview/" in the GitHub Pages build) - public/ asset URLs must
// be prefixed with it, since Vite doesn't rewrite plain string literals.
function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path}`;
}

export const SURVEYS: SurveyConfig[] = [
  {
    kind: "scalar",
    name: "00_radio_haslam_408mhz",
    label: "電波 (Haslam 408MHz)",
    rawUrl: dataUrl("png/00_radio_haslam_408mhz.png"),
  },
  {
    kind: "color",
    name: "01_infrared_akari_90um",
    label: "赤外線 (AKARI 90um)",
    rawUrl: dataUrl("png_colored/01_infrared_akari_90um.png"),
  },
  {
    kind: "scalar",
    name: "02_visible_gaia_dr3_density",
    label: "可視光 (Gaia DR3 密度マップ)",
    rawUrl: dataUrl("png/02_visible_gaia_dr3_density.png"),
  },
  {
    kind: "color",
    name: "02b_visible_gaia_dr3_color",
    label: "可視光カラー (Gaia DR3 RGBフラックス)",
    rawUrl: dataUrl("png/02b_visible_gaia_dr3_color.png"),
  },
  {
    kind: "scalar",
    name: "02c_visible_dss2_red",
    label: "可視光 (DSS2 Red)",
    rawUrl: dataUrl("png/02c_visible_dss2_red.png"),
  },
  {
    kind: "color",
    name: "02c_visible_dss2_red+02d_visible_dss2_blue_rgb",
    label: "可視光 (DSS2 rgb)",
    rawUrl: dataUrl("png_colored/02c_visible_dss2_red+02d_visible_dss2_blue_rgb.png"),
  },
  {
    kind: "scalar",
    name: "03_ultraviolet_galex_nuv",
    label: "紫外線 (GALEX NUV)",
    rawUrl: dataUrl("png/03_ultraviolet_galex_nuv.png"),
  },
  {
    kind: "scalar",
    name: "04_xray_rosat_rass",
    label: "X線 (ROSAT RASS)",
    rawUrl: dataUrl("png/04_xray_rosat_rass.png"),
  },
  {
    kind: "scalar",
    name: "05_gamma_fermi_300_1000mev",
    label: "ガンマ線 (Fermi 300-1000MeV)",
    rawUrl: dataUrl("png/05_gamma_fermi_300_1000mev.png"),
  },
];

export function findSurvey(name: string): SurveyConfig {
  const found = SURVEYS.find((s) => s.name === name);
  if (!found) {
    throw new Error(`Unknown survey: ${name}`);
  }
  return found;
}
