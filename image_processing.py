"""
Shared FITS -> 8-bit image processing, used by both the batch pipeline
(convert_allsky_png.py) and the interactive tuning app (fits_studio.py).
Kept dependency-light (numpy + Pillow only; matplotlib is imported lazily
inside apply_colormap since only the interactive app needs it) and free of
any hard-coded resolution so both callers can pass whatever size they need.
"""

from __future__ import annotations

import warnings

import numpy as np
from PIL import Image

DEFAULT_STRENGTH = {
    "asinh": 10.0,
    "log": 1000.0,
}


def downsample_mean(data: np.ndarray, out_width: int, out_height: int) -> np.ndarray:
    """
    Area-average downsample by an exact integer factor.

    A block that's only partially covered (some NaN pixels - e.g. GALEX's
    incomplete sky coverage) still gets a valid mean from just its finite
    pixels; a block that's *entirely* uncovered stays NaN, matching how
    stretch_image() already treats individual NaN pixels. Downsampling the
    raw data before stretching (rather than shrinking the stretched 8-bit
    image afterward) also acts as a noise-reducing low-pass filter and
    keeps the percentile-based black/white points computed on the
    resolution actually being exported.
    """
    in_height, in_width = data.shape
    if in_width % out_width or in_height % out_height:
        raise ValueError(
            f"Input size {in_width}x{in_height} is not an integer multiple of "
            f"output size {out_width}x{out_height}."
        )
    factor_x = in_width // out_width
    factor_y = in_height // out_height
    reshaped = data.reshape(out_height, factor_y, out_width, factor_x)
    with warnings.catch_warnings():
        # An all-NaN block correctly produces NaN via nanmean; the RuntimeWarning
        # it raises for that case is expected here, not a bug to surface.
        warnings.simplefilter("ignore", category=RuntimeWarning)
        return np.nanmean(reshaped, axis=(1, 3))


def resize_to(data: np.ndarray, out_width: int, out_height: int) -> np.ndarray:
    """
    Resize `data` (2D float array, NaN-aware) to an arbitrary target size:
    exact-integer-factor shrinks use downsample_mean() (better quality,
    handles NaN correctly); anything else (upscale, or a non-integer
    factor) falls back to a general resize on a NaN-filled-with-0 copy.
    """
    in_height, in_width = data.shape
    if out_width == in_width and out_height == in_height:
        return data
    if in_width % out_width == 0 and in_height % out_height == 0:
        return downsample_mean(data, out_width, out_height)

    finite = np.isfinite(data)
    filled = np.where(finite, data, 0.0).astype(np.float32)
    coverage = finite.astype(np.float32)

    filled_img = Image.fromarray(filled, mode="F").resize((out_width, out_height), Image.Resampling.BILINEAR)
    coverage_img = Image.fromarray(coverage, mode="F").resize((out_width, out_height), Image.Resampling.BILINEAR)

    filled_arr = np.asarray(filled_img)
    coverage_arr = np.asarray(coverage_img)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        result = filled_arr / coverage_arr
    result[coverage_arr <= 0] = np.nan
    return result


def stretch_image(
    data: np.ndarray,
    min_percentile: float,
    max_percentile: float,
    stretch: str,
    strength: float | None = None,
    gamma: float = 1.0,
) -> np.ndarray:
    """
    Normalize `data` to its [min_percentile, max_percentile] range, apply a
    base stretch curve, then an optional extra gamma curve on top for fine
    brightness tuning independent of the base stretch's own shape. Returns
    uint8 in [0, 255]; NaN pixels become 0 (black).
    """
    data = np.asarray(data, dtype=np.float32)

    finite = np.isfinite(data)
    if not np.any(finite):
        raise ValueError("Image contains no finite pixels.")

    valid_values = data[finite]
    low, high = np.nanpercentile(valid_values, [min_percentile, max_percentile])

    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        low = float(np.nanmin(valid_values))
        high = float(np.nanmax(valid_values))

    normalized = (data - low) / max(high - low, np.finfo(np.float32).eps)
    normalized = np.clip(normalized, 0.0, 1.0)

    if stretch == "asinh":
        strength = strength if strength is not None else DEFAULT_STRENGTH["asinh"]
        normalized = np.arcsinh(strength * normalized) / np.arcsinh(strength)
    elif stretch == "sqrt":
        normalized = np.sqrt(normalized)
    elif stretch == "log":
        strength = strength if strength is not None else DEFAULT_STRENGTH["log"]
        normalized = np.log1p(strength * normalized) / np.log1p(strength)
    elif stretch != "linear":
        raise ValueError(f"Unknown stretch: {stretch}")

    if gamma != 1.0:
        normalized = np.clip(normalized, 0.0, 1.0) ** (1.0 / gamma)

    normalized[~finite] = 0.0
    return np.round(np.clip(normalized, 0.0, 1.0) * 255.0).astype(np.uint8)


def apply_colormap(gray: np.ndarray, colormap_name: str) -> np.ndarray:
    """Map a uint8 grayscale array through a named matplotlib colormap, returning uint8 RGB."""
    import matplotlib

    cmap = matplotlib.colormaps[colormap_name]
    rgba = cmap(gray.astype(np.float32) / 255.0, bytes=True)
    return rgba[..., :3]


def apply_custom_colormap(gray: np.ndarray, hex_colors: list[str]) -> np.ndarray:
    """Map a uint8 grayscale array through a custom linear gradient defined by 2+ hex color stops, evenly spaced across [0, 1]."""
    from matplotlib.colors import LinearSegmentedColormap

    if len(hex_colors) < 2:
        raise ValueError("Need at least 2 color stops for a gradient.")
    cmap = LinearSegmentedColormap.from_list("custom", hex_colors)
    rgba = cmap(gray.astype(np.float32) / 255.0, bytes=True)
    return rgba[..., :3]


def combine_rgb(red_gray: np.ndarray, blue_gray: np.ndarray, green_mode: str = "average") -> np.ndarray:
    """
    Combine two independently-stretched uint8 grayscale bands into an RGB
    image (red_gray -> R channel, blue_gray -> B channel) - for surveys
    like DSS2 that only publish Red/Blue plates (no G), for a more
    photographic look than a single-band + synthetic colormap.

    green_mode (there's no real G data, so it has to be synthesized):
    - "average": (R+B)/2 - simple, generally natural-looking.
    - "sqrt": sqrt(R*B) - geometric mean; favors pixels bright in *both*
      channels over ones bright in only one, tends to desaturate less.
    - "zero": no synthesized green - a pure red/blue duotone.
    """
    red = red_gray.astype(np.float32)
    blue = blue_gray.astype(np.float32)

    if green_mode == "average":
        green = (red + blue) / 2.0
    elif green_mode == "sqrt":
        green = np.sqrt(red * blue)
    elif green_mode == "zero":
        green = np.zeros_like(red)
    else:
        raise ValueError(f"Unknown green_mode: {green_mode}")

    rgb = np.stack([red, green, blue], axis=-1)
    return np.round(np.clip(rgb, 0.0, 255.0)).astype(np.uint8)
