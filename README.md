# Logic PK - 判定・選択・表示システム

## 概要

このリポジトリは、競技「Logic PK」向けのローカル運用システムです。

現在の標準運用は次です。

- MESH 明るさブロック 1 個をゴール成功判定センサーとして使う
- RED 用 2 ボタン、BLUE 用 2 ボタン、審判用 1 ボタンを使う
- Mac は RED 画面、モニター1 は BLUE 画面、モニター2 は全体画面として使う

重要:

- 試合前の設定編集は RED 画面だけで行います
- BLUE 画面と全体画面は、setup 中でも初期設定の閲覧画面を表示します
- プレイヤー用ボタンは、単押し・ダブルクリック・長押しを区別しません
- `mesh-ble.config.json` が旧版のままならボタンは動きません。更新後は `npm run ble:register` を一度実行してください

## 正として見る文書

- [README.md](README.md)
- [SPEC.md](SPEC.md)
- [OPERATION_MANUAL.md](OPERATION_MANUAL.md)
- [MESH_BLE_DIRECT.md](MESH_BLE_DIRECT.md)
- [MESH_BLOCK_REGISTRATION.md](MESH_BLOCK_REGISTRATION.md)

## 画面構成

- `/team/red`
  - setup 中: RED の設定編集画面
  - 試合開始後: RED チーム画面
- `/team/blue`
  - setup 中: BLUE 用の準備確認画面
  - 試合開始後: BLUE チーム画面
- `/`
  - setup 中: 全体モニター用の準備確認画面
  - 試合開始後: メイン画面
  - 試合終了後: 結果もこの画面に表示

## ボタン構成

論理上のボタン役割は 5 つです。現在の Logic PK 実装では、各論理ボタンに別々の物理 MESH ボタンが必要です。

- `redCycle`
  - RED の候補送り
- `redConfirm`
  - RED の確定 / やり直し
- `blueCycle`
  - BLUE の候補送り
- `blueConfirm`
  - BLUE の確定 / やり直し
- `refereeControl`
  - 審判操作

同じ物理ボタンを `redCycle` と `blueCycle` のように複数の論理ボタンへ共有すると、1 回の押下で複数コマンドが同時に飛び、選択フェーズが壊れます。`redCycle`, `redConfirm`, `blueCycle`, `blueConfirm`, `refereeControl` は必ず別々の MESH ボタンへ割り当ててください。

### RED / BLUE ボタン

- ボタン1: 次候補へ進める
- ボタン2: 現在候補を確定する
- どの押し方でも同じ動作です

投げる側は `投球者 -> 距離` の順で進みます。守る側は `ボール -> 追加得点の向き` の順で進みます。追加得点の向きは選べますが、そのラウンド内で残り権利が 0 の向きは選べません。

表示制限:

- 両チームがそのターンの全項目を決めきるまでは、相手チームが決めている内容は相互に非表示です
- 全体画面 `/` でも、両チームの選択がそろうまではターン詳細を公開しません
- 追加得点の向きは、両チームの選択がそろった後も、成功 / 失敗 / 無効の結果が確定するまで非表示です

### 審判ボタン

試合前と試合後:

- 単押し: 次の項目へ
- ダブルクリック: 前の項目へ
- 長押し: 現在項目を実行

試合中:

- 選択フェーズ: 長押しでターン開始
- 投球フェーズ: 長押しでレビューへ
- レビューフェーズ
  - 単押し: 判定項目移動
  - ダブルクリック: 現在項目の値変更
  - 長押し: `confirm` 上で結果確定

## 自動キャリブレーション

現在の標準は自動キャリブレーションです。

- `minRaw` は常に `0`
- `emptyRaw` は現在のセンサー値
- `triggerThreshold` は現在設定値を維持

つまり、「空ゴール時の値だけを取り直す」構成です。

## 起動

```bash
npm install
npm run ble:stop
npm run ble:register
npm run dev:with-ble
```

Web UI だけなら:

```bash
npm run dev
```

## リセットと停止

試合結果だけを消して setup に戻したい場合:

```bash
npm run match:reset
```

Node サーバを完全に止めたい場合:

```bash
npm run server:stop
```

注意:

- `npm run dev:with-ble` は `3000` 番の既存サーバを再利用することがあります
- そのため、`Ctrl+C` したつもりでも別のサーバプロセスが残っていると、状態は残って見えます
- 永続化しているのは `calibration.json` のキャリブレーション値だけで、試合結果そのものはメモリ上です

## 実運用の画面割り当て

- Mac: `http://localhost:5173/team/red`
- モニター1: `http://localhost:5173/team/blue`
- モニター2: `http://localhost:5173/`

Vite のポートが `5173` 以外へずれた場合は、その起動ログの URL を使ってください。

## BLE 構成

標準構成は 6 ブロックです。

- 明るさブロック 1 個
  - `goalSensor`
- RED ボタン 2 個
  - `redCycle`
  - `redConfirm`
- BLUE ボタン 2 個
  - `blueCycle`
  - `blueConfirm`
- 審判ボタン 1 個
  - `refereeControl`

設定テンプレートは [mesh-ble.config.example.json](mesh-ble.config.example.json) です。

## 現在の前提と制限

- 単一ゴール、明るさセンサー 1 本前提です
- 成功検知はセンサーで行いますが、得点確定は審判レビュー後です
- 試合中の操作はボタンで完結できます
- チーム名、選手名、基礎点、ボールのチーム別利用権の編集は RED setup 画面で行います

## 最初に見る文書

- 実運用手順: [OPERATION_MANUAL.md](OPERATION_MANUAL.md)
- BLE 接続: [MESH_BLE_DIRECT.md](MESH_BLE_DIRECT.md)
- ブロック差し替え: [MESH_BLOCK_REGISTRATION.md](MESH_BLOCK_REGISTRATION.md)
- 仕様詳細: [SPEC.md](SPEC.md)
