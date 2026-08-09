#!/usr/bin/env python3
"""
Interactive FITS -> colorized PNG tuning tool for the all-sky survey
pipeline (see allsky_surveys.py). Lets you dial in stretch/percentile/
gamma/colormap per survey with a live preview, then export a PNG at any
resolution - a companion to the batch convert_allsky_png.py, for finding
good parameters (and eventually producing final pre-colored textures; see
image_processing.py, shared by both tools) rather than repeatedly guessing
CLI flags.

Also supports a 2-band RGB composite mode (e.g. DSS2 Red + DSS2 Blue -> a
more photographic-looking color image than a single band + colormap, for
surveys that publish separate color plates but no combined RGB product),
and a Gaia rasterization mode (magnitude-weighted PSF star field, see
docs/gaia-magnitude-pipeline-plan.md) with its own tunable star-size and
color-tint controls, distinct from FITS percentile/stretch tuning since it
renders directly from a star catalog rather than a raster image.

Install:
    python -m pip install streamlit astropy numpy pillow matplotlib

Run:
    streamlit run fits_studio.py

Notes:
- Only "scalar" (single-band FITS) surveys are listed - "color" surveys
  (e.g. the Gaia DR3 RGB flux map) are pre-rendered and have nothing to
  stretch/colorize.
- Requires the raw FITS already downloaded (download_allsky_fits.py);
  surveys missing their raw file are skipped in the picker with a note.
- The live preview always renders at a small fixed resolution for
  responsiveness; only the final export uses the resolution you choose.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import streamlit as st
from astropy.io import fits
from PIL import Image

from allsky_surveys import FITS_DIR, PNG_HEIGHT, PNG_WIDTH, SURVEYS
from download_bright_star_catalog import catalog_path_for as bright_star_catalog_path_for
from image_processing import (
    DEFAULT_STRENGTH,
    apply_colormap,
    apply_custom_colormap,
    combine_rgb,
    resize_to,
    stretch_image,
)
from rasterize_gaia_catalog import load_and_merge_stars
from rasterize_gaia_catalog import rasterize as gaia_rasterize_gray
from rasterize_gaia_catalog_color import load_and_merge_color_stars
from rasterize_gaia_catalog_color import rasterize_color as gaia_rasterize_color
from rasterize_gaia_catalog_color import stretch_rgb

PREVIEW_WIDTH = 900
PREVIEW_HEIGHT = PREVIEW_WIDTH // 2

OUTPUT_DIR = Path("allsky_textures") / "png_colored"

# Per-survey (and per-band-pair, for composite mode) tuned parameters,
# persisted across app restarts. A plain dict-of-dicts (not a fixed schema)
# so adding fields later - e.g. a magnitude cutoff for Gaia once that gets
# a real implementation - doesn't require a migration; missing fields just
# fall back to a hardcoded default.
PARAMS_PATH = Path("studio_params.json")
COMPOSITE_NAMESPACE = "__composite__"


def load_saved_params() -> dict:
    if not PARAMS_PATH.exists():
        return {}
    try:
        return json.loads(PARAMS_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def save_params(key: str, params: dict, namespace: str | None = None) -> None:
    all_params = load_saved_params()
    if namespace:
        all_params.setdefault(namespace, {})[key] = params
    else:
        all_params[key] = params
    PARAMS_PATH.write_text(json.dumps(all_params, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


COLORMAPS = ["gray", "inferno", "viridis", "magma", "plasma", "cividis", "hot", "bone", "turbo", "cubehelix", "custom"]
STRETCHES = ["asinh", "sqrt", "log", "linear"]
DEFAULT_CUSTOM_COLORS = ["#000000", "#3b82f6", "#ffffff"]
GREEN_MODES = ["average", "sqrt", "zero"]
GREEN_MODE_LABELS = {
    "average": "(R+B)/2 (推奨)",
    "sqrt": "sqrt(R*B) (両方明るい所を強調)",
    "zero": "0 (赤青2色のみ)",
}

# Notes on getting a good-looking result per survey - things that aren't
# obvious just from staring at the sliders. Free-form, meant to grow as we
# learn what works for each one.
SURVEY_HINTS = {
    "00_radio_haslam_408mhz": (
        "電波(408MHz)全天マップ。銀河面のシンクロトロン放射が主体で、"
        "ダイナミックレンジが広い。asinhでコンパクトに圧縮し、strengthを"
        "上げると銀河面外の淡い構造も見えやすくなる。"
    ),
    "01_infrared_akari_90um": (
        "遠赤外線(90um)全天マップ。星間塵からの熱放射で、銀河面・分子雲が"
        "よく見える。asinh + 中程度のstrengthが基本。"
    ),
    "02_visible_gaia_dr3_density": (
        "Gaia DR3の「星密度マップ」。等級情報はこの時点で失われているため、"
        "percentileやstrengthをどう調整しても、明るい星が個別に目立ち暗い星は"
        "淡く滲む、という写真的なリアルさは原理的に再現できない。"
        "銀河面が過度に明るいのを抑えたいだけならmin percentileを上げる/"
        "strengthを下げるのが手っ取り早いが、本質的な解決には"
        "Gaiaカタログから等級付きデータを取得する別実装が必要。"
    ),
    "02c_visible_dss2_red": (
        "DSS2 redバンド。実際の写真乾板スキャンなので、他サーベイより"
        "リアルな星空の見た目に近い。asinhで階調を保ちつつハイライトを"
        "圧縮するとバランスが良い。単バンドで見るより、下の「2バンド合成」"
        "モードでDSS2 blueと組み合わせる方が見た目通りに近づく。"
    ),
    "02d_visible_dss2_blue": (
        "DSS2 blueバンド。単体では使わず、02c(red)と組み合わせて"
        "「2バンド合成」モードで見るのが基本。"
    ),
    "02e_visible_gaia_dr3_mag": (
        "Gaia DR3を等級付きでカタログ取得し(download_gaia_catalog.py)、"
        "等級で明るさ・大きさを変えたGaussian PSFでラスタライズしたもの"
        "(rasterize_gaia_catalog.py)。02の密度マップと違い、明るい星が"
        "大きく/明るく写る写真的な見た目になる。Gaiaは非常に明るい肉眼等級の"
        "星(目安G≲3等、シリウス・ベテルギウスなど)で検出器が飽和し等級が"
        "信頼できない既知の制限があるが(docs/gaia-data-fields-examples.md"
        "参照)、Yale Bright Star Catalogueで該当の星を正しいV等級に置き換え"
        "済み(download_bright_star_catalog.py)。"
    ),
    "03_ultraviolet_galex_nuv": (
        "GALEX近紫外線。全天をカバーしていない(未観測領域は黒/NaN)。"
        "strengthを上げすぎると欠測領域との境界が不自然に目立つので注意。"
    ),
    "04_xray_rosat_rass": (
        "ROSAT全天X線サーベイ。点源(高エネルギー天体)が主体でダイナミック"
        "レンジが広い。sqrtで階調を落ち着かせるのが基本、asinhだと"
        "点源が飽和しやすい。"
    ),
    "05_gamma_fermi_300_1000mev": (
        "Fermiガンマ線(300MeV-1GeV)。空間分解能が低くぼやけた見た目が"
        "自然。sqrtで十分、strengthを上げても細部は出てこない。"
    ),
    "06_gravitational_gwtc_skymap": (
        "GWOSC/GWTC確認済みイベント(261件)の重力波源位置確率マップを"
        "重ね合わせたもの(download_gw_skymaps.py→rasterize_gw_skymaps.py)。"
        "重力波は画像ではなく複数検出器の到達時刻差による三角測量なので、"
        "個々のイベントは点源ではなく数十〜数千平方度に広がった淡い帯/"
        "弧として写る(3検出器で見えた良い局在イベントほど狭く明るい)。"
        "GW170817のみ電磁対対応天体(NGC 4993)による既知の正確な位置を"
        "小さなGaussianで代用。各イベントのHEALPix値はネイティブ解像度が"
        "イベントごとに大きく異なるため、ピクセル立体角で割って密度に"
        "変換してから重ね合わせている(していないと局在の良し悪しが"
        "見た目に反映されない)。max percentileを99.99付近まで上げると"
        "局在イベント同士の明るさの差がよく見える。"
    ),
    "07_neutrino_icecat1_gold_bronze": (
        "IceCube ICECAT-1カタログ(2011-2023年の高エネルギーGold/Bronze"
        "アラートイベント340件、download_icecube_catalog.py)を、各イベントの"
        "90%信頼区間の誤差箱サイズ(角度)をGaussianの広がりに、SIGNAL"
        "(天体起源である確率)を明るさに変換してラスタライズしたもの"
        "(rasterize_icecube_catalog.py)。GWと同様、局在が良いイベントほど"
        "小さく明るく、悪いイベントほど大きく淡く写る。一部の領域に"
        "見える密なクラスタは偶然ではなく、数年おきに同じ方向から"
        "繰り返し検出された既知の候補天体(multiplet)。"
    ),
}


@st.cache_data(show_spinner="FITSを読み込み中...")
def load_survey_data(survey_name: str) -> np.ndarray:
    path = FITS_DIR / f"{survey_name}.fits"
    with fits.open(path, memmap=True) as hdul:
        data = np.squeeze(hdul[0].data)
    return np.asarray(data, dtype=np.float32)


@st.cache_data(show_spinner=False)
def preview_data(survey_name: str, width: int, height: int) -> np.ndarray:
    return resize_to(load_survey_data(survey_name), width, height)


def render_band(raw: np.ndarray, params: dict) -> np.ndarray:
    """Stretch one band to uint8 grayscale, north-up (no colormap - used standalone or as one channel of a composite)."""
    gray = stretch_image(raw, params["min_percentile"], params["max_percentile"], params["stretch"], params["strength"], params["gamma"])
    # FITS/WCS vertical direction and image texture direction can differ,
    # same flip as convert_allsky_png.py so preview matches the real export.
    return np.flipud(gray)


def render_single(raw: np.ndarray, params: dict, colormap: str, custom_colors: list[str] | None) -> np.ndarray:
    gray = render_band(raw, params)
    if colormap == "custom":
        return apply_custom_colormap(gray, custom_colors or DEFAULT_CUSTOM_COLORS)
    return apply_colormap(gray, colormap)


def band_controls(label_prefix: str, config: dict, defaults: dict, key_prefix: str) -> dict:
    """Percentile/stretch/strength/gamma widgets for one band. `label_prefix` (e.g. "赤バンド ") is prepended to each widget's label so red/blue controls in composite mode read distinctly; pass "" for single-band mode."""

    def label(text: str) -> str:
        return f"{label_prefix}{text}" if label_prefix else text

    min_p, max_p = st.slider(
        label("percentile範囲(黒点・白点)"),
        0.0,
        100.0,
        (
            float(defaults.get("min_percentile", config.get("min_percentile", 1.0))),
            float(defaults.get("max_percentile", config.get("max_percentile", 99.7))),
        ),
        step=0.1,
        key=f"{key_prefix}_percentile",
    )
    stretch = st.selectbox(
        label("stretch方式"),
        STRETCHES,
        index=STRETCHES.index(defaults.get("stretch", config.get("stretch", "asinh"))),
        key=f"{key_prefix}_stretch",
    )

    # Only reuse the saved strength if it was tuned for this same stretch
    # method - switching stretch method falls back to that method's own
    # default rather than carrying over a value tuned for a different curve.
    default_strength = defaults.get("strength") if defaults.get("stretch") == stretch else None

    strength: float | None = None
    if stretch == "asinh":
        strength = st.slider(
            label("strength (asinh)"), 0.5, 100.0, float(default_strength or DEFAULT_STRENGTH["asinh"]), step=0.5, key=f"{key_prefix}_strength_asinh"
        )
    elif stretch == "log":
        strength = st.slider(
            label("strength (log)"), 10.0, 5000.0, float(default_strength or DEFAULT_STRENGTH["log"]), step=10.0, key=f"{key_prefix}_strength_log"
        )

    gamma = st.slider(
        label("明度カーブ (gamma)"),
        0.2,
        3.0,
        float(defaults.get("gamma", 1.0)),
        step=0.05,
        help="1.0で無効。ストレッチ後に追加でかける補正カーブ。大きいほど中間調が明るくなる。",
        key=f"{key_prefix}_gamma",
    )

    return {"min_percentile": min_p, "max_percentile": max_p, "stretch": stretch, "strength": strength, "gamma": gamma}


# Gaia mode: rasterizes straight from a downloaded star catalog (see
# rasterize_gaia_catalog.py / rasterize_gaia_catalog_color.py), not from a
# raster FITS - so it gets its own cached compute step instead of
# load_survey_data/preview_data above. The full 8192x4096 splat is the slow
# part (~4s for ~480k stars); caching it means only actually-changed
# rasterize-affecting params (not stretch-only tweaks) pay that cost.
@st.cache_data(show_spinner="Gaiaカタログを読み込み中...")
def load_gaia_gray(mag_limit: float, use_bright_stars: bool) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    return load_and_merge_stars(mag_limit, 3.5 if use_bright_stars else None)


@st.cache_data(show_spinner="Gaiaカタログを読み込み中...")
def load_gaia_color(mag_limit: float, use_bright_stars: bool, saturation: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return load_and_merge_color_stars(mag_limit, 3.5 if use_bright_stars else None, saturation=saturation)


@st.cache_data(show_spinner="ラスタライズ中...")
def rasterize_gaia_gray_cached(
    mag_limit: float, use_bright_stars: bool, mag_cutoff: float, sigma_base: float, sigma_scale: float, sigma_max: float
) -> np.ndarray:
    ra, dec, mag = load_gaia_gray(mag_limit, use_bright_stars)
    mask = mag < mag_cutoff
    return gaia_rasterize_gray(ra[mask], dec[mask], mag[mask], mag_limit, sigma_base, sigma_scale, sigma_max)


@st.cache_data(show_spinner="ラスタライズ中...")
def rasterize_gaia_color_cached(
    mag_limit: float,
    use_bright_stars: bool,
    mag_cutoff: float,
    sigma_base: float,
    sigma_scale: float,
    sigma_max: float,
    saturation: float,
) -> np.ndarray:
    ra, dec, mag, rgb = load_gaia_color(mag_limit, use_bright_stars, saturation)
    mask = mag < mag_cutoff
    return gaia_rasterize_color(ra[mask], dec[mask], mag[mask], rgb[mask], mag_limit, sigma_base, sigma_scale, sigma_max)


st.set_page_config(page_title="FITS Studio", layout="wide")
st.title("FITS Studio")

scalar_surveys = {name: cfg for name, cfg in SURVEYS.items() if cfg.get("kind", "scalar") != "color"}
available = {name: cfg for name, cfg in scalar_surveys.items() if (FITS_DIR / f"{name}.fits").exists()}

if not available:
    st.error(f"生FITSが見つかりません。先に download_allsky_fits.py を実行してください。({FITS_DIR})")
    st.stop()

missing = set(scalar_surveys) - set(available)
saved_params = load_saved_params()

mode = st.sidebar.radio("モード", ["単バンド", "2バンド合成 (RGB)", "Gaiaラスタライズ"], key="mode")
if missing:
    st.sidebar.caption(f"未ダウンロードのため非表示: {', '.join(sorted(missing))}")

if mode == "単バンド":
    with st.sidebar:
        st.header("サーベイ")
        survey_name = st.selectbox("survey", list(available.keys()), key="single_survey")

        hint = SURVEY_HINTS.get(survey_name)
        if hint:
            st.info(hint)

        config = available[survey_name]
        # Saved values (from a previous session, this survey specifically) win
        # over the SURVEYS config defaults; both are just fallbacks for a
        # survey that's never been tuned in the Studio before.
        defaults = saved_params.get(survey_name, {})

        st.header("ストレッチ")
        band_params = band_controls("", config, defaults, key_prefix=f"single__{survey_name}")

        st.header("配色")
        colormap = st.selectbox(
            "colormap",
            COLORMAPS,
            index=COLORMAPS.index(defaults.get("colormap", "gray")) if defaults.get("colormap") in COLORMAPS else 0,
            key=f"colormap__{survey_name}",
        )

        custom_colors: list[str] | None = None
        if colormap == "custom":
            # Only reuse saved stop colors if they were saved for "custom"
            # specifically (same reasoning as strength above).
            saved_colors = defaults.get("custom_colors") if defaults.get("colormap") == "custom" else None
            base_colors = saved_colors or DEFAULT_CUSTOM_COLORS
            num_stops = st.slider(
                "色の数",
                2,
                6,
                len(base_colors),
                key=f"custom_stops__{survey_name}",
                help="黒点(0)から白点(1)までを、この数の色で均等に補間したグラデーションを作る。",
            )
            custom_colors = [
                st.color_picker(
                    f"色 {i + 1}",
                    base_colors[i] if i < len(base_colors) else "#ffffff",
                    key=f"custom_color_{i}__{survey_name}",
                )
                for i in range(num_stops)
            ]

        st.header("出力")
        output_width = st.number_input(
            "出力幅(px)",
            min_value=64,
            max_value=8192,
            value=int(defaults.get("output_width", PNG_WIDTH)),
            step=64,
            help=f"高さは幅/2に自動設定される(全天マップは2:1)。既定のWeb版テクスチャ解像度は{PNG_WIDTH}x{PNG_HEIGHT}。",
            key=f"output_width__{survey_name}",
        )
        output_height = output_width // 2
        st.caption(f"出力サイズ: {output_width} x {output_height}")

    # Auto-persist so this survey's settings are still here next time it's
    # selected, this session or a future one - no explicit "save" step needed.
    current_params = {**band_params, "colormap": colormap, "custom_colors": custom_colors, "output_width": output_width}
    if current_params != defaults:
        save_params(survey_name, current_params)

    preview_raw = preview_data(survey_name, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    preview_rgb = render_single(preview_raw, band_params, colormap, custom_colors)

    st.image(preview_rgb, use_container_width=True, caption=f"{survey_name} プレビュー ({PREVIEW_WIDTH}x{PREVIEW_HEIGHT}, 表示用の簡易解像度)")

    with st.expander("現在のパラメータ"):
        st.caption(f"{survey_name} の設定として {PARAMS_PATH} に自動保存済み。次回このサーベイを開いた時に復元されます。")
        st.code(
            f'"min_percentile": {band_params["min_percentile"]},\n'
            f'"max_percentile": {band_params["max_percentile"]},\n'
            f'"stretch": "{band_params["stretch"]}",\n'
            f"# strength={band_params['strength']}, gamma={band_params['gamma']}, colormap={colormap!r} は"
            " Studio専用パラメータ(allsky_surveys.SURVEYS / convert_allsky_png.py"
            " のCLIにはまだ無い設定 - 移植する場合は手動で)",
            language="python",
        )

    if st.sidebar.button("この設定でPNGを書き出す", type="primary", key="export_single"):
        with st.spinner(f"{output_width}x{output_height} で書き出し中..."):
            export_raw = resize_to(load_survey_data(survey_name), output_width, output_height)
            export_rgb = render_single(export_raw, band_params, colormap, custom_colors)
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            out_path = OUTPUT_DIR / f"{survey_name}.png"
            Image.fromarray(export_rgb, mode="RGB").save(out_path, optimize=False, compress_level=4)
        st.sidebar.success(f"書き出しました: {out_path}")

elif mode == "2バンド合成 (RGB)":
    band_survey_names = list(available.keys())
    default_red = "02c_visible_dss2_red" if "02c_visible_dss2_red" in band_survey_names else band_survey_names[0]
    default_blue_candidates = [n for n in ("02d_visible_dss2_blue",) if n in band_survey_names]
    default_blue = default_blue_candidates[0] if default_blue_candidates else band_survey_names[0]

    with st.sidebar:
        st.header("バンド選択")
        red_survey = st.selectbox("赤(R)チャンネル survey", band_survey_names, index=band_survey_names.index(default_red), key="composite_red_survey")
        blue_survey = st.selectbox("青(B)チャンネル survey", band_survey_names, index=band_survey_names.index(default_blue), key="composite_blue_survey")

        composite_key = f"{red_survey}+{blue_survey}"
        composite_saved = saved_params.get(COMPOSITE_NAMESPACE, {})
        comp_defaults = composite_saved.get(composite_key, {})

        st.header("赤バンド")
        red_params = band_controls("", available[red_survey], comp_defaults.get("red", {}), key_prefix=f"comp_red__{composite_key}")

        st.header("青バンド")
        blue_params = band_controls("", available[blue_survey], comp_defaults.get("blue", {}), key_prefix=f"comp_blue__{composite_key}")

        st.header("緑チャンネル")
        green_mode = st.selectbox(
            "G(緑)の生成方法",
            GREEN_MODES,
            format_func=lambda k: GREEN_MODE_LABELS[k],
            index=GREEN_MODES.index(comp_defaults.get("green_mode", "average")),
            key=f"comp_green__{composite_key}",
            help="DSS2はRed/Blueプレートのみで緑バンドが無いため、赤と青から合成する。",
        )

        st.header("出力")
        output_width = st.number_input(
            "出力幅(px)",
            min_value=64,
            max_value=8192,
            value=int(comp_defaults.get("output_width", PNG_WIDTH)),
            step=64,
            help=f"高さは幅/2に自動設定される(全天マップは2:1)。既定のWeb版テクスチャ解像度は{PNG_WIDTH}x{PNG_HEIGHT}。",
            key=f"comp_output_width__{composite_key}",
        )
        output_height = output_width // 2
        st.caption(f"出力サイズ: {output_width} x {output_height}")

    current_composite_params = {"red": red_params, "blue": blue_params, "green_mode": green_mode, "output_width": output_width}
    if current_composite_params != comp_defaults:
        save_params(composite_key, current_composite_params, namespace=COMPOSITE_NAMESPACE)

    red_preview_raw = preview_data(red_survey, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    blue_preview_raw = preview_data(blue_survey, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    composite_preview = combine_rgb(render_band(red_preview_raw, red_params), render_band(blue_preview_raw, blue_params), green_mode)

    st.image(
        composite_preview,
        use_container_width=True,
        caption=f"{red_survey} (R) + {blue_survey} (B) 合成プレビュー ({PREVIEW_WIDTH}x{PREVIEW_HEIGHT}, 表示用の簡易解像度)",
    )

    with st.expander("現在のパラメータ"):
        st.caption(f"{composite_key} の設定として {PARAMS_PATH} に自動保存済み。次回この組み合わせを選んだ時に復元されます。")
        st.json(current_composite_params)

    if st.sidebar.button("この設定でPNGを書き出す", type="primary", key="export_composite"):
        with st.spinner(f"{output_width}x{output_height} で書き出し中..."):
            red_export_raw = resize_to(load_survey_data(red_survey), output_width, output_height)
            blue_export_raw = resize_to(load_survey_data(blue_survey), output_width, output_height)
            export_rgb = combine_rgb(render_band(red_export_raw, red_params), render_band(blue_export_raw, blue_params), green_mode)
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            out_path = OUTPUT_DIR / f"{red_survey}+{blue_survey}_rgb.png"
            Image.fromarray(export_rgb, mode="RGB").save(out_path, optimize=False, compress_level=4)
        st.sidebar.success(f"書き出しました: {out_path}")

else:  # "Gaiaラスタライズ"
    gaia_catalog_dir = Path("allsky_textures") / "gaia_catalog"
    available_catalogs = sorted(gaia_catalog_dir.glob("gaia_dr3_g*.csv")) if gaia_catalog_dir.exists() else []

    if not available_catalogs:
        st.error(f"Gaiaカタログが見つかりません。先に download_gaia_catalog.py を実行してください。({gaia_catalog_dir})")
        st.stop()

    catalog_mag_limits = [float(p.stem.removeprefix("gaia_dr3_g")) for p in available_catalogs]
    has_bright_catalog = bright_star_catalog_path_for(3.5).exists()
    gaia_defaults = saved_params.get("gaia", {})

    st.info(
        "Gaia DR3を等級付きでカタログ取得し、等級で明るさ・大きさを変えたGaussian PSFで"
        "直接ラスタライズするモード。FITSの明暗を後から伸縮する単バンド/2バンド合成とは違い、"
        "「どの明るさの星をどれくらいの大きさ・色で描くか」という生成そのもののパラメータを"
        "調整する。カタログ自体は download_gaia_catalog.py / download_bright_star_catalog.py で"
        "事前に取得したものを使う(このアプリからは再クエリしない)。"
    )

    with st.sidebar:
        st.header("カタログ")
        catalog_mag_limit = st.selectbox("ダウンロード済みカタログ (G <)", catalog_mag_limits, key="gaia_catalog_mag_limit")

        mag_cutoff = st.slider(
            "表示する等級の足切り (G <)",
            1.0,
            float(catalog_mag_limit),
            min(float(gaia_defaults.get("mag_cutoff", catalog_mag_limit)), float(catalog_mag_limit)),
            step=0.5,
            help="ダウンロード済みカタログの範囲内で、さらに明るい星だけに絞り込める(再ダウンロード不要)。",
            key="gaia_mag_cutoff",
        )

        use_bright_stars = st.checkbox(
            "明るい星を補完する (Yale BSC, G≲3等の飽和対策)",
            value=bool(gaia_defaults.get("use_bright_stars", True)) and has_bright_catalog,
            disabled=not has_bright_catalog,
            key="gaia_use_bright_stars",
        )
        if not has_bright_catalog:
            st.caption("bright_stars_v3.5.csv が無いので無効化中 (download_bright_star_catalog.py を実行)")

        colored = st.checkbox("着彩する (BP-RP色指数)", value=bool(gaia_defaults.get("colored", True)), key="gaia_colored")

        st.header("星のサイズ (等級 → PSF半径)")
        sigma_base = st.slider(
            "最小サイズ (最も暗い星)", 0.3, 3.0, float(gaia_defaults.get("sigma_base", 0.9)), step=0.1, key="gaia_sigma_base"
        )
        sigma_scale = st.slider(
            "1等あたりの増加量", 0.0, 1.0, float(gaia_defaults.get("sigma_scale", 0.4)), step=0.05, key="gaia_sigma_scale"
        )
        sigma_max = st.slider(
            "最大サイズ (最も明るい星)", 1.0, 15.0, float(gaia_defaults.get("sigma_max", 6.0)), step=0.5, key="gaia_sigma_max"
        )

        gray_colormap: str | None = None
        gray_custom_colors: list[str] | None = None
        if colored:
            st.header("色")
            saturation = st.slider(
                "色の濃さ (彩度)",
                0.0,
                2.0,
                float(gaia_defaults.get("saturation", 1.0)),
                step=0.1,
                help="0で白黒、1が基準の色付け。大きいほど各星が自分の色を"
                "誇張する(赤い星はより赤く、青い星はより青く。白い星は白のまま) - "
                "全体を一律に赤/青へ寄せるわけではない。",
                key="gaia_saturation",
            )
            st.header("ストレッチ")
            percentile = st.slider(
                "正規化パーセンタイル", 95.0, 100.0, float(gaia_defaults.get("percentile", 99.9)), step=0.01, key="gaia_color_percentile"
            )
            strength = st.slider(
                "strength (asinh)", 1.0, 50.0, float(gaia_defaults.get("strength", 10.0)), step=1.0, key="gaia_color_strength"
            )
        else:
            saturation = 1.0
            st.header("ストレッチ")
            gray_params = band_controls("", {}, gaia_defaults, key_prefix="gaia_gray")
            percentile, strength = gray_params["max_percentile"], gray_params["strength"] or DEFAULT_STRENGTH["asinh"]

            st.header("配色")
            gray_colormap = st.selectbox(
                "colormap",
                COLORMAPS,
                index=COLORMAPS.index(gaia_defaults.get("colormap", "gray")) if gaia_defaults.get("colormap") in COLORMAPS else 0,
                key="gaia_gray_colormap",
            )
            if gray_colormap == "custom":
                saved_colors = gaia_defaults.get("custom_colors") if gaia_defaults.get("colormap") == "custom" else None
                base_colors = saved_colors or DEFAULT_CUSTOM_COLORS
                num_stops = st.slider("色の数", 2, 6, len(base_colors), key="gaia_custom_stops")
                gray_custom_colors = [
                    st.color_picker(f"色 {i + 1}", base_colors[i] if i < len(base_colors) else "#ffffff", key=f"gaia_custom_color_{i}")
                    for i in range(num_stops)
                ]

        st.header("出力")
        output_width = st.number_input(
            "出力幅(px)",
            min_value=64,
            max_value=8192,
            value=int(gaia_defaults.get("output_width", PNG_WIDTH)),
            step=64,
            key="gaia_output_width",
        )
        output_height = output_width // 2
        st.caption(f"出力サイズ: {output_width} x {output_height}")

    current_gaia_params = {
        "mag_cutoff": mag_cutoff,
        "use_bright_stars": use_bright_stars,
        "colored": colored,
        "sigma_base": sigma_base,
        "sigma_scale": sigma_scale,
        "sigma_max": sigma_max,
        "saturation": saturation,
        "percentile": percentile,
        "strength": strength,
        "colormap": gray_colormap,
        "custom_colors": gray_custom_colors,
        "output_width": output_width,
    }
    if current_gaia_params != gaia_defaults:
        save_params("gaia", current_gaia_params)

    if colored:
        full_canvas = rasterize_gaia_color_cached(catalog_mag_limit, use_bright_stars, mag_cutoff, sigma_base, sigma_scale, sigma_max, saturation)
        preview_small = np.stack([resize_to(full_canvas[:, :, c], PREVIEW_WIDTH, PREVIEW_HEIGHT) for c in range(3)], axis=-1)
        preview_rgb = np.flipud(stretch_rgb(preview_small, percentile, strength))
    else:
        full_canvas = rasterize_gaia_gray_cached(catalog_mag_limit, use_bright_stars, mag_cutoff, sigma_base, sigma_scale, sigma_max)
        preview_small = resize_to(full_canvas, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        gray_params_for_stretch = {"min_percentile": 0.0, "max_percentile": percentile, "stretch": "asinh", "strength": strength, "gamma": 1.0}
        preview_rgb = render_single(preview_small, gray_params_for_stretch, gray_colormap or "gray", gray_custom_colors)

    st.image(preview_rgb, use_container_width=True, caption=f"Gaia等級ラスタライズ プレビュー ({PREVIEW_WIDTH}x{PREVIEW_HEIGHT}, 表示用の簡易解像度)")

    with st.expander("現在のパラメータ"):
        st.caption(f"gaia の設定として {PARAMS_PATH} に自動保存済み。")
        st.json(current_gaia_params)

    if st.sidebar.button("この設定でPNGを書き出す", type="primary", key="export_gaia"):
        with st.spinner(f"{output_width}x{output_height} で書き出し中..."):
            if colored:
                export_small = np.stack([resize_to(full_canvas[:, :, c], output_width, output_height) for c in range(3)], axis=-1)
                export_rgb = np.flipud(stretch_rgb(export_small, percentile, strength))
                out_name = f"02f_visible_gaia_dr3_color_g{catalog_mag_limit:g}cut{mag_cutoff:g}.png"
            else:
                export_small = resize_to(full_canvas, output_width, output_height)
                export_rgb = render_single(export_small, gray_params_for_stretch, gray_colormap or "gray", gray_custom_colors)
                out_name = f"02e_visible_gaia_dr3_mag_g{catalog_mag_limit:g}cut{mag_cutoff:g}.png"
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            out_path = OUTPUT_DIR / out_name
            Image.fromarray(export_rgb, mode="RGB").save(out_path, optimize=False, compress_level=4)
        st.sidebar.success(f"書き出しました: {out_path}")
