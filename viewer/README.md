# All-Sky Viewer

球の内側から全天球サーベイ(電波〜ガンマ線 + Gaia DR3カラー)を眺めるWebビューア。
Vite + TypeScript + Three.jsのスタンドアロンアプリ。仕様は
[`../docs/web-viewer-spec.md`](../docs/web-viewer-spec.md) を参照。

## セットアップ

```bash
npm install
npm run dev
```

`public/data` は `../allsky_textures` へのシンボリックリンク(開発用)。
実データは `convert_allsky_png.py` で事前に生成しておくこと
(`02b_visible_gaia_dr3_color` はまだ未取得。取得するには
`python ../download_allsky_fits.py --survey 02b_visible_gaia_dr3_color` の後
`python ../convert_allsky_png.py --survey 02b_visible_gaia_dr3_color`)。

## テスト

```bash
npm test
```

`astro/`(座標変換)・`galacticToDirection.ts`(銀河座標→ワールド方向)・
`scene/createCompassRing.ts`(リング幾何)・`skyCameraOrientation.ts`
(カメラへの反映)に対するVitestの回帰テスト。実際の空と同期モードのデバッグで
発見・修正したバグ(南北反転、`Object3D.lookAt()`の180°反転、`up`基準の誤り、
天頂特異点)がすべて回帰テストとして残っている。実機テストなしでも
`npm test`だけである程度の変更の妥当性を確認できる
(詳細な経緯は[`../docs/sky-lock-debug-plan.md`](../docs/sky-lock-debug-plan.md))。

## データ形式(FITSではなくPNG)

当初はFITSを直接ブラウザで読み、stretch/colormapをクライアント側で自由に
変えられる設計だったが、デプロイ時のペイロード(FITSは1サーベイ約128MB、
合計800〜900MB)が大きすぎるため、`convert_allsky_png.py`が生成する
事前stretch済み8bitグレースケールPNG(合計約130MB)を読み込む方式に変更した。

トレードオフ: stretch方式・strength・percentileはPython側で焼き込み済みで、
ブラウザ側では変更できない。ただし colormap(グレースケール値へのLUT適用)は
クライアント側で引き続き切り替え可能。

## 起動時の挙動

`src/main.ts` が起動時に全サーベイのPNG(合計約130MB)を一括プリロードする。
個々のサーベイの読み込みに失敗しても(例えば`02b_visible_gaia_dr3_color`が
未取得の場合)、そのサーベイをスキップして他のサーベイの表示は継続する。

GPUには「レイヤーA」「レイヤーB」の2枚分のテクスチャのみを都度アップロードし、
レイヤー切り替え時に古いテクスチャを`dispose()`する。

## 実際の空と同期モード

スマートフォンで「実際の空と同期」ボタンを押すと、Geolocation(緯度・経度)と
DeviceOrientation(コンパス方位・傾き)から現在向いている方角の空を計算し、
カメラをその方向に固定する(`src/skyLock.ts`, `src/astro/`)。

- 銀河座標→ワールド方向の変換は、既知の銀河中心(Sgr A*)がカメラ中央に
  くることをスクリーンショット比較で較正済み。
- コンパス方位(東西南北)・高度角の符号はiOS/Androidでセンサー基準が
  微妙に異なり、実機でしか最終確認できない。方角が反転しているなど
  おかしい場合は`src/sensors/deviceOrientation.ts`の符号を調整すること。
- 対応していない環境(PCブラウザ、許可拒否時)は自動的にボタンが消える。

## デプロイに関する注意

このアプリは完全な静的サイトとして動作するが、`public/data`は開発用の
シンボリックリンクなので、本番ホスティング先には実データ(PNGファイル、
合計約130MB)をそのまま配置する必要がある。

GitHub Pagesへのデプロイは`.github/workflows/deploy.yml`が自動で行う
(pushをトリガーに、`allsky_textures/png/`を`public/data/png/`へ実体コピーして
ビルド)。個別ファイルは全て100MB未満なのでGit LFSは不要で、リポジトリに
直接コミットしている(`allsky_textures/fits/`は大きすぎるため`.gitignore`で除外)。

## 対応環境

WebGL2が使えるモダンブラウザのみを想定。WebGL1へのフォールバックは実装していない。

## ライセンス・データ出典

このリポジトリのコードにライセンスファイルは付与していない(無断での
複製・再配布は不可)。

表示している各サーベイのデータは、それぞれの提供元の権利・利用規約に従う
(このプロジェクトが独自にライセンスを与えるものではない):

- **電波 (Haslam 408MHz)**: Haslam et al. 全天408MHzサーベイ。CDS HiPS `CDS/P/Haslam408/v2` 経由
- **赤外線 (AKARI 90um)**: JAXA/ISAS AKARI(あかり)衛星, FIS。CDS HiPS `CDS/P/AKARI/FIS/WideS` 経由
- **可視光 (Gaia DR3)**: ESA/Gaia/DPAC(Gaia Data Processing and Analysis Consortium)。CDS HiPS `CDS/P/DM/...I/355/gaiadr3` 経由
- **紫外線 (GALEX NUV)**: NASA/Caltech GALEX。CDS HiPS `CDS/P/GALEXGR6_7/NUV` 経由
- **X線 (ROSAT RASS)**: MPE(Max Planck Institute for Extraterrestrial Physics)ROSAT All-Sky Survey。CDS HiPS `ov-gso/P/RASS` 経由
- **ガンマ線 (Fermi)**: NASA Fermi Gamma-ray Space Telescope, LAT Collaboration。CDS HiPS `CDS/P/Fermi/3` 経由
- **可視光 (DSS2 Red)**: Digitized Sky Survey - STScI/NASA。**利用規約:
  <http://archive.stsci.edu/dss/copyright.html>**(FITSヘッダーの`CPYRIGHT`カードに明記)

いずれもCDS(Centre de Données astronomiques de Strasbourg, Université de
Strasbourg/CNRS)のHiPSサービス・hips2fitsサービス経由で取得している。
