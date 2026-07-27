# 全体システム構成

最終更新: 2026-07-27

Pythonのデータ取得パイプライン(オフライン・事前実行)と、`viewer/`のWebアプリ
(ブラウザ・実行時)の2段構成。詳細仕様は[`web-viewer-spec.md`](./web-viewer-spec.md)、
実装プランは`viewer/README.md`を参照。

**2026-07-27時点でFITS直読みからPNG読み込みに方針転換済み**(デプロイ時の
ペイロード削減のため。経緯は`web-viewer-spec.md`参照)。下図は現行のPNG方式。

```mermaid
flowchart TD
    subgraph EXT["外部サービス"]
        HIPS["CDS hips2fits<br/>(HiPSサーベイ)"]
    end

    subgraph PY["Pythonパイプライン(事前実行・オフライン)"]
        CFG["allsky_surveys.py<br/>(SURVEYS定義 + WCS)"]
        DL["download_allsky_fits.py<br/>--survey / --force"]
        CONV["convert_allsky_png.py<br/>--stretch --strength<br/>--min/max-percentile"]

        CFG --> DL
        CFG --> CONV
    end

    subgraph FILES["allsky_textures/"]
        FITS["fits/*.fits (scalar, float32/64)<br/>fits/*.png (color, Gaia DR3 RGB)"]
        PNG["png/*.png<br/>(事前stretch済み8bitグレースケール<br/>+ colorサーベイはそのままコピー)"]
    end

    HIPS --> DL --> FITS
    FITS --> CONV --> PNG

    subgraph VIEWER["viewer/ (Vite + TypeScript + Three.js, ブラウザ実行)"]
        SYMLINK["public/data<br/>(symlinkでpng/を直接配信)"]

        subgraph BOOT["起動時プリロード"]
            LOADALL["loadAllSurveys.ts<br/>(全8サーベイのPNGをImage要素でfetch, 逐次)"]
        end

        subgraph GPU["GPUテクスチャ(アクティブ2レイヤーのみ)"]
            TEX["textures.ts<br/>(THREE.Textureラップ)"]
            LUT["colormaps.ts<br/>(grayscale/inferno/viridis LUT)"]
            MAT["SkyLayerMaterial.ts<br/>(ShaderMaterial, uniform A/B)"]
            SHADER["sky.vert.ts / sky.frag.ts<br/>(グレースケール値→LUT→mix、<br/>colorサーベイはRGB直接サンプル)"]
        end

        subgraph SCENE["3Dシーン"]
            SPHERE["createSkySphere.ts<br/>(scale(-1,1,1)で内側から見る球)"]
            THREE["Three.js Renderer + OrbitControls<br/>(WebGL2)"]
        end

        subgraph SKYLOCK["実際の空と同期モード"]
            SENSORS["sensors/geolocation.ts<br/>sensors/deviceOrientation.ts"]
            ASTRO["astro/time.ts (LST)<br/>astro/coords.ts (AltAz→赤道→銀河)<br/>astro/galacticToDirection.ts"]
            SKYLOCKCTRL["skyLock.ts<br/>(SkyLockController)"]
            BUTTON["ui/skyLockButton.ts"]

            SENSORS --> SKYLOCKCTRL
            ASTRO --> SKYLOCKCTRL
            BUTTON --> SKYLOCKCTRL
        end

        UI["debugPanel.ts<br/>サーベイA/B・colormap・blendスライダー"]
        MAIN["main.ts<br/>(全体を配線 / 起動フロー)"]

        SYMLINK --> LOADALL
        MAIN --> LOADALL
        LOADALL --> MAIN
        MAIN -->|applyLayer(slot, state)| TEX
        TEX --> MAT
        LUT --> MAT
        MAT --> SHADER
        SHADER --> SPHERE
        SPHERE --> THREE
        UI -->|onLayerChange / onBlendChange| MAIN
        MAIN --> UI
        SKYLOCKCTRL -->|camera.lookAt each frame, controls無効化| THREE
        MAIN --> SKYLOCKCTRL
    end

    FILES -->|HTTP fetch| SYMLINK
```

## 補足

- **データ形式**: `viewer/`アプリは`allsky_textures/png/`配下の事前stretch済み
  PNGのみを読む(生FITSはブラウザ側では扱わない)。合計payload は約130MB
  (旧FITS方式の800〜900MBから大幅削減)。トレードオフとしてstretch方式/
  strength/percentileはPython側で焼き込み済みで、ブラウザ側では変更できない。
  colormap(グレースケール値へのLUT適用)のみクライアント側で切り替え可能。
- **GPUメモリ戦略**: 起動時に全8サーベイをプリロードするが、GPUテクスチャとして
  アップロードするのはクロスフェード中の2レイヤー(A/B)分のみ。レイヤーの
  切り替え時に古いテクスチャを`dispose()`する。
- `02b_visible_gaia_dr3_color`はカラーサーベイのため、シェーダー内でcolormap
  パスをスキップし直接RGBをサンプルする(`uKindA`/`uKindB`で分岐)。
- **実際の空と同期モード**: Geolocation(緯度経度)とDeviceOrientation
  (コンパス方位・傾き)から地平座標(Alt/Az)を求め、現在時刻の恒星時を使って
  赤道座標→銀河座標→球のワールド方向に変換し、毎フレーム`camera.lookAt()`で
  向きを固定する。有効化中は`OrbitControls`を無効化する。銀河中心(Sgr A*)が
  画面中央に来ることをスクリーンショット比較で較正済みだが、コンパス方位の
  符号はiOS/Androidで基準が異なるため実機でのみ最終確認できる。
