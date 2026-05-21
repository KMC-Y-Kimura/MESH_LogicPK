# Logic PK 技術仕様

## 1. 概要

このシステムは、Logic PK の 1 試合を次の単位で管理します。

- 試合設定
- 各ターンの選択
- ターン開始
- ゴールセンサーによる成功検知
- 審判による結果確定
- 試合終了時の勝敗判定

現在の標準実装は次です。

- 単一ゴール
- 明るさセンサー 1 本
- RED 2 ボタン
- BLUE 2 ボタン
- 審判 1 ボタン

## 2. 画面構成

- `/team/red`
  - `setup` 中は設定編集画面
  - それ以外は RED チーム画面
- `/team/blue`
  - `setup` 中は準備確認画面
  - それ以外は BLUE チーム画面
- `/`
  - `setup` 中は全体準備画面
  - それ以外はメイン画面
  - `finished` では結果もここに表示

## 3. 試合フェーズ

```ts
type MatchPhase = "setup" | "selection" | "active" | "review" | "finished";
```

## 4. ボタン ID

```ts
type KnownButtonId =
  | "redCycle"
  | "redConfirm"
  | "blueCycle"
  | "blueConfirm"
  | "refereeControl";
```

## 5. プレイヤーボタン仕様

プレイヤー用の4ボタンは、押し方を区別しません。

- `redCycle` / `blueCycle`
  - 候補を1つ進める
- `redConfirm` / `blueConfirm`
  - 現在候補を確定する
  - `done` 状態では選択やり直し

`single` `double` `long` は BLE では受けますが、サーバ側では同一コマンドとして扱います。

## 6. 審判ボタン仕様

### 6.1 setup / finished

- 単押し: 次項目
- ダブルクリック: 前項目
- 長押し: 実行

対象:

- `duration`
- `firstThrowingTeam`
- `triggerThreshold`
- `autoCalibration`
- `startMatch`
- `reset`

### 6.2 selection

- 長押し: ターン開始

### 6.3 active

- 長押し: レビューへ

### 6.4 review

- 単押し: 項目移動
- ダブルクリック: 値変更
- 長押し: `confirm` で確定

## 7. 自動キャリブレーション

```ts
minRaw = 0
emptyRaw = latestRaw
triggerThreshold = current.triggerThreshold
```

## 8. 得点と勝敗

得点ルールと勝敗判定順は現行の Logic PK 実装どおりです。

- ボール利用権:
  - 各ボールは `RED` と `BLUE` で別々の残数を持つ
  - setup では各チームごとに `1` または `2` を設定する
  - 片方のチームが使っても、もう片方の残数は減らない
- 追加得点の向き:
  - 守る側が手動で選択する
  - `投げた側へ距離点` と `守る側へ平均基礎点` の 2 方向がある
  - 各チームは、そのラウンド内で「追加得点の受け先」になる権利を `参加人数` 回持つ
  - そのため、残り権利が `0` の向きは選択できない
- 表示ルール:
  - チーム画面では、両チームがそのターンの全項目を決めきるまでは、相手チームが決めた内容を表示しない
  - 全体画面でも、両チームの選択がそろうまではターン詳細を表示しない
  - 追加得点の向きは、両チームの選択がそろった後も、成功 / 失敗 / 無効が確定するまで表示しない
- 成功時:
  - 投球者基礎点を投げた側へ加算
  - `distance` なら距離点を投げた側へ加算
  - `opponentAverage` なら平均基礎点を守る側へ加算
- 失敗 / 無効: 0 点

勝敗判定順:

1. 切り上げ後得点
2. 実得点
3. 反則数
4. 失格

## 9. 現在の実務上の前提

- 試合中の操作はボタンで完結可能
- ただし、チーム名や選手名などの自由入力は RED setup 画面で行う
- 単一センサー前提なので、複数ゴール化には追加実装が必要
