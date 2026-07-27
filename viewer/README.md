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
合計約130MB)をそのまま配置する必要がある。デプロイ先は未定
(`docs/web-viewer-spec.md`の「未確定・次の検討事項」を参照)。

GitHub Pagesでホストする場合の注意: 個別ファイルは100MB未満なので
push自体は可能だが、Gitリポジトリに130MBのバイナリを直接コミットするのは
避け、Git LFS(ただしGitHub PagesはLFS実体を配信しない)以外の方法を
検討すること。

## 対応環境

WebGL2が使えるモダンブラウザのみを想定。WebGL1へのフォールバックは実装していない。
