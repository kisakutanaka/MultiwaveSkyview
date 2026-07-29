# 「実際の空と同期」モード カメラ挙動バグ 切り分け計画

## 症状の経緯

1. **初回報告**: 実機(iPhone)で有効化すると、実際のスマホの動きに反してカメラの向きが
   「グリングリン」変わる。単純な反転ではなく、あちこちに飛ぶような動き。
   - 原因候補として特定・修正: iOSの`webkitCompassHeading`は無効値のとき`-1`を返す仕様が
     あり、`sensors/deviceOrientation.ts`の`resolveAlphaDeg`がこれを有効な方位として
     扱っていた(`alpha = 360 - (-1) = 361°`にジャンプ)。`iosHeading >= 0`のチェックを追加。
   - あわせてカメラ向きの反映をslerpで滑らかにする平滑化(`SMOOTHING_FACTOR`)を追加。

2. **2回目の報告**: 上記修正後、今度は「視点が定期的にどこかに戻される」症状。
   - 原因を特定・修正: `main.ts`の`animate()`では`controls.update()`(OrbitControls)が
     `skyLock.update()`より先に呼ばれる。`OrbitControls.update()`は`enabled=false`でも
     毎フレーム自分の内部状態でカメラの向きを強制的に上書きするため、
     `camera.quaternion`を起点にslerpしていた実装は、毎フレーム
     「OrbitControlsが凍結している古い向き」から20%だけ動く→次フレームでまた
     引き戻される、を繰り返していた。
   - 修正: `SkyLockController`内部に独立した`currentQuaternion`を持たせ、そちらをslerpし、
     `controls.update()`の後で`camera.quaternion`に強制上書きする形に変更
     (`skyLock.ts`)。

3. **3回目の報告(今回)**: それでも南に固定されたり、自由視点から切り替えた瞬間の
   カメラの向きに引きずられているような挙動が見える。

## ユーザーの仮説

- 初期姿勢定義の実装が違う
- 回転の計算方法が違う
- センサから取得した値の反映方法が違う

## 方針: スモールステップでの切り分け

これまで2回、「直したつもりが実は別の場所で干渉していた」を繰り返しているため、
パイプライン全体を一度に検証するのをやめ、各段階を独立に(前後の段階に依存せず)
個別に検証できるデバッグUIを用意して、どの段階に問題があるかを一つずつ確定させる。

```
[1] センサー生値 (alpha/beta/gamma, webkitCompassHeading)
        │
[2] 方位角のみ (azDeg) ← 現在ここを検証中
        │
[3] 高度角込みの姿勢 (altDeg, azDeg)
        │
[4] AltAz → 赤道座標 → 銀河座標 → ワールド方向 (astro/, galacticToDirection.ts)
        │
[5] カメラへの反映 (quaternion適用・平滑化・OrbitControlsとの干渉)
```

### ステップ1(実装済み): 方位角(azimuth)のみを単体検証

ジオロケーション・銀河座標変換・カメラを一切介さず、「センサーの生値から
正しく方位を読み取れているか」だけを確認する最小テストパネルを追加した。

- `viewer/src/ui/headingCheckPanel.ts`(新規)
- 画面右下に「方位チェック開始」ボタンが表示される(`isDeviceOrientationSupported()`
  の場合のみ)。位置情報の許可は不要。
- 押すとDeviceOrientation権限のみをリクエストし、以下をリアルタイム表示:
  - 計算結果: `N (12°)` のような大きな表示(`sensors/deviceOrientation.ts`の
    `computeAltAz`が出す`azDeg`を16方位に丸めたもの)
  - 詳細行: `webkitCompassHeading(raw)` / `alpha(raw)` / `beta` / `gamma` / `absolute`

**確認方法**: 実際に北・東・南・西を向いて(方位アプリ等の既知の基準と比較しながら)、
表示される方位が実際の向きと一致するかを見る。

- 一致する → ステップ[1]〜[2]は正しい。次はステップ3(仰角込み)、
  ステップ4(座標変換)を疑う。
- 一致しない → `computeAltAz`のオイラー角/クォータニオン構成
  (`deviceOrientation.ts`の`SCREEN_TO_CAMERA`や`"YXZ"`の並び)か、
  `resolveAlphaDeg`の符号・基準がそもそも間違っている可能性が高い。

### ステップ2(未実装): 仰角込みの姿勢を単体検証

ステップ1のパネルを拡張し、`altDeg`も表示。スマホを水平・真上・斜めに向けて、
表示される高度角が直感と一致するかを確認する。

### ステップ3(部分実装済み): 座標変換パイプラインの検証

`skyLock.ts`の`enable()`で生成しているコンパスリング(`scene/createCompassRing.ts`)が
これに相当する。ただしステップ1・2が確定するまでは、ここで見えるズレが
どの段階由来か切り分けられないため、優先度はステップ1・2の後。

### ステップ4(未着手): カメラへの反映の再検証

ステップ2で「一度直したはずのバグ」(OrバンControls干渉)が該当した箇所。
`skyLock.ts`の`update()`(`currentQuaternion`のslerp→`camera.quaternion`への
上書き)と`main.ts`の`animate()`内の呼び出し順序に問題がないか、
ステップ1〜3が正しいと確定してから再検証する。

## 次にやること

1. 実機でステップ1(方位チェックパネル)の結果を確認してもらう
   (北/東/南/西を向けて、表示される方位が合っているか)。
2. 結果に応じて、ステップ1が原因ならセンサー変換式(`computeAltAz`)を、
   問題なければステップ2(高度角)のデバッグ表示を追加して次に進む。
