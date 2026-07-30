# viewer アプリ ファイル・関数フローチャート

`viewer/src`配下の現状(2026-07-30時点)のファイル構成と、主要な関数呼び出し・データの流れをまとめたもの。`types.ts`(共有型定義のみ)と`ui/icons.ts`(SVG文字列定数のみ)はロジックを持たないため図からは省略。

```mermaid
flowchart TD
  subgraph BOOT["main.ts — 起動シーケンス"]
    boot1["Three.js初期化<br/>Scene / PerspectiveCamera / WebGLRenderer / OrbitControls"]
    boot2["new SkyLayerMaterial()"]
    boot3["createSkySphere(material)"]
    boot4["new SkyLockController(camera, controls)"]
    boot5["UIコンポーネント組み立て<br/>topIconBar / headingCheckPanel / ringCheckButton"]
    boot6["animate() 開始"]
    boot7["main() 非同期処理開始"]
    boot1 --> boot2 --> boot3
    boot3 --> boot4 --> boot5 --> boot6
    boot5 --> boot7
  end

  subgraph LOOP["毎フレームループ (main.ts: animate)"]
    loopCtrl["controls.update()"]
    loopSky["skyLock.update(deltaSeconds)"]
    loopRender["renderer.render(scene, camera)"]
    loopCtrl --> loopSky --> loopRender
  end
  boot6 --> loopCtrl

  subgraph DATA["サーベイデータ (data/)"]
    surveysTs["surveys.ts<br/>SURVEYS配列 (name/label/kind/rawUrl)"]
    loadAll["loadAllSurveys()<br/>(loadAllSurveys.ts)<br/>全PNGを並行フェッチ→Map"]
    texturesTs["createTextureForSurvey()<br/>(textures.ts)"]
    colormapsTs["createAllColormapTextures()<br/>(colormaps.ts)"]
    surveysTs --> loadAll
  end
  boot7 --> loadAll

  subgraph RENDER["3Dシーン (scene/ + gl/)"]
    applyLayer["applyLayer(slot, state)<br/>main.ts内のローカル関数"]
    skyMat["SkyLayerMaterial.setLayer()<br/>uTextureA/B・uColormapA/B・uKindA/B"]
    skyBlend["SkyLayerMaterial.setBlend()<br/>uBlend"]
    shaders["sky.vert.ts / sky.frag.ts<br/>kind別サンプリング→2層をuBlendでmix"]
    sphere["createSkySphere()<br/>(createSkySphere.ts)<br/>半径500の内向きスフィア"]
    ring["createCompassRing() / disposeCompassRing()<br/>(createCompassRing.ts)<br/>N/E/S/W/天頂の実証用リング"]
    applyLayer --> skyMat --> shaders
    skyBlend --> shaders
    shaders -.appliedTo.-> sphere
  end
  loadAll --> applyLayer
  texturesTs --> applyLayer
  colormapsTs --> applyLayer
  boot3 --> sphere

  subgraph UI["UI操作 (ui/)"]
    layerBar["layerBar.ts<br/>レイヤーA/B選択 + ブレンドスライダー"]
    colormapPanel["colormapPanel.ts<br/>デバッグ専用カラーマップ選択"]
    debugToggle["debugToggle.ts<br/>デバッグ系UIの表示切替"]
    uiVisibility["uiVisibilityToggle.ts<br/>UI全体の表示/非表示"]
    skyLockBtn["skyLockButton.ts<br/>同期モードON/OFFボタン"]
    sensorPanel["sensorDebugPanel.ts<br/>生センサー値の常時表示"]
    headingPanel["headingCheckPanel.ts<br/>方位角/仰角の単体チェック"]
    ringBtn["ringCheckButton.ts<br/>コンパスリング単体表示(自由視点)"]
  end
  boot5 --> UI
  layerBar -->|"onSurveyChange"| applyLayer
  layerBar -->|"onBlendChange"| skyBlend
  colormapPanel -->|"onColormapChange"| applyLayer
  debugToggle -.->|"表示切替"| colormapPanel
  debugToggle -.->|"表示切替"| sensorPanel
  debugToggle -.->|"表示切替"| headingPanel
  debugToggle -.->|"表示切替"| ringBtn

  subgraph SKYLOCK["skyLock.ts — 実際の空と同期モード"]
    slEnable["SkyLockController.enable()<br/>権限リクエスト"]
    slUpdate["SkyLockController.update(deltaSeconds)<br/>毎フレーム"]
    slDisable["SkyLockController.disable()"]
  end
  skyLockBtn -->|"enable() / disable()"| slEnable
  skyLockBtn --> slDisable
  loopSky --> slUpdate
  SKYLOCK -->|"onDebugUpdate"| sensorPanel

  subgraph SENSORS["センサー入力 (sensors/)"]
    geoTs["geolocation.ts<br/>requestGeoPosition()"]
    devOrientTs["deviceOrientation.ts<br/>DeviceOrientationTracker<br/>start() / stop()"]
    outlierTs["outlierFilter.ts<br/>filterOutlier()<br/>方位角のレートリミッタ"]
    devOrientTs --> outlierTs
  end
  slEnable --> geoTs
  slEnable -->|"tracker.start()"| devOrientTs
  devOrientTs -->|"latestSample"| slUpdate
  headingPanel -->|"tracker.start()"| devOrientTs
  ringBtn --> geoTs

  subgraph SKYCAM["skyCameraOrientation.ts"]
    computeQuat["computeSkyDirectionQuaternion(sample, position, date)"]
    computeSmooth["computeSmoothingFactor(deltaSeconds, timeConstant)"]
  end
  slUpdate --> computeQuat
  slUpdate --> computeSmooth
  computeQuat -->|"camera.quaternion.copy()"| loopRender

  subgraph ASTRO["座標変換 (astro/)"]
    timeTs["time.ts<br/>localSiderealTimeDeg()"]
    coordsTs["coords.ts<br/>altAzToEquatorial()<br/>equatorialToGalactic()"]
    galDirTs["galacticToDirection.ts<br/>galacticToWorldDirection()"]
    timeTs --> coordsTs --> galDirTs
  end
  computeQuat --> timeTs
  computeQuat --> coordsTs
  computeQuat --> galDirTs
  ringBtn --> timeTs
  ringBtn --> ring
```

## 主要な流れの要約

1. **起動**: `main.ts`がThree.jsの土台(Scene/Camera/Renderer/OrbitControls)を作り、`SkyLayerMaterial`を積んだスフィアをシーンに追加。`SkyLockController`とUI一式を組み立てたあと`animate()`ループを開始し、並行して`main()`が全サーベイPNGのプリロードを始める。
2. **サーベイ表示**: `loadAllSurveys()`で読み込んだデータを`applyLayer()`が`SkyLayerMaterial.setLayer()`経由でシェーダーのuniformに反映。`layerBar.ts`のレイヤーA/B選択・ブレンドスライダーがこの`applyLayer`/`setBlend`を直接叩く。
3. **実際の空と同期モード**: `skyLockButton`押下で`SkyLockController.enable()`が位置情報とセンサー権限を取得し、`DeviceOrientationTracker`を起動。毎フレーム`update()`が最新のセンサー値を`skyCameraOrientation.computeSkyDirectionQuaternion()`に渡し、`astro/`配下の時刻→赤道座標→銀河座標→ワールド方向の変換チェーンを経てカメラの向きを決定、スムージングしてから`camera.quaternion`に反映する。
4. **デバッグツール群**: `headingCheckPanel`(センサー単体チェック)と`ringCheckButton`(コンパスリング単体表示)は、どちらも`skyLock.ts`を経由せず`sensors/`・`astro/`・`scene/createCompassRing.ts`を直接呼ぶ独立した検証ツール。`debugToggle`でまとめて表示/非表示を切り替えられる。
