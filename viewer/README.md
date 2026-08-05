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

以下2件は上記HiPS経由ではなく、それぞれ専用のパイプライン
(`download_gaia_catalog.py`等・`download_gw_skymaps.py`)で個別取得している:

- **可視光 (Gaia DR3 等級・着色)**: ESA/Gaia/DPAC(Gaia Data Processing and
  Analysis Consortium)。Gaia Archive(ESAC)のTAPサービスから
  `gaiadr3.gaia_source`を直接クエリして取得(`download_gaia_catalog.py`)。
  推奨謝辞文: "This work has made use of data from the European Space Agency
  (ESA) mission Gaia (<https://www.cosmos.esa.int/gaia>), processed by the
  Gaia Data Processing and Analysis Consortium (DPAC,
  <https://www.cosmos.esa.int/web/gaia/dpac/consortium>)."
  また、Gaia自体が飽和する肉眼等級の明るい星(G≲3等)の等級補正には
  **Yale Bright Star Catalogue, 5th Revised Ed.**(Hoffleit & Warren, 1991;
  VizieRカタログ `V/50`)をCDS/VizieR経由で使用している
  (`download_bright_star_catalog.py`)。
- **重力波 (GWTC 確認済みイベント)**: LIGO Scientific Collaboration, Virgo
  Collaboration, KAGRA Collaborationが公開する重力波イベントカタログ
  (GWTC-1/2.1/3/4.1/5.0)のスカイローカリゼーションマップを、
  Gravitational Wave Open Science Center(GWOSC, <https://gwosc.org>)経由で
  取得・合成している(`download_gw_skymaps.py`, `rasterize_gw_skymaps.py`)。
  GWOSCの利用規約で要求される謝辞文(原文のまま引用):
  > This research has made use of data or software obtained from the
  > Gravitational Wave Open Science Center (gwosc.org), a service of the
  > LIGO Scientific Collaboration, the Virgo Collaboration, and KAGRA.
  > LIGO Laboratory and Advanced LIGO are funded by the United States
  > National Science Foundation (NSF) as well as the Science and Technology
  > Facilities Council (STFC) of the United Kingdom, the Max-Planck-Society
  > (MPS), and the State of Niedersachsen/Germany for support of the
  > construction of Advanced LIGO and construction and operation of the
  > GEO600 detector. Additional support for Advanced LIGO was provided by
  > the Australian Research Council. Virgo is funded, through the European
  > Gravitational Observatory (EGO), by the French Centre National de
  > Recherche Scientifique (CNRS), the Italian Istituto Nazionale di Fisica
  > Nucleare (INFN) and the Dutch Nikhef, with contributions by institutions
  > from Belgium, Germany, Greece, Hungary, Ireland, Japan, Monaco, Poland,
  > Portugal, Spain. KAGRA is supported by Ministry of Education, Culture,
  > Sports, Science and Technology (MEXT), Japan Society for the Promotion
  > of Science (JSPS) in Japan; National Research Foundation (NRF) and
  > Ministry of Science and ICT (MSIT) in Korea; Academia Sinica (AS) and
  > National Science and Technology Council (NSTC) in Taiwan.
  GW170817のみ電磁対応天体(NGC 4993)由来の既知の正確な位置を使用しており、
  GWOSCのスカイマップファイルは使用していない。
