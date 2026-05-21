# MESH 直接 BLE 接続

## 1. 現在の前提

このプロジェクトでは、MESH アプリを使わずに PC から MESH ブロックへ直接 BLE 接続します。

現行の標準構成は次です。これは論理役割の一覧で、物理ボタンは必要なら再利用できます。

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

## 2. 起動手順

```bash
npm install
npm run ble:stop
npm run ble:register
npm run dev:with-ble
```

## 3. 発見だけ行う

```bash
npm run ble:discover
```

## 4. 設定ファイル

標準テンプレートは `mesh-ble.config.example.json` です。

プレイヤーボタンは、1 個の物理ボタンに対して `single/double/long` を全部登録しますが、最終的には同じ `buttonId` として扱います。つまり、どの押し方でも同じコマンドになります。

## 5. 登録のしかた

`npm run ble:register` は現在、次の 6 役割を順に選ばせます。同じ物理ボタンを複数回選んでも構いません。

1. `goalSensor`
2. `redCycle`
3. `redConfirm`
4. `blueCycle`
5. `blueConfirm`
6. `refereeControl`

## 6. プレイヤーボタンの意味

- `redCycle` / `blueCycle`
  - 候補を1つ進める
- `redConfirm` / `blueConfirm`
  - 現在候補を確定する
  - `done` 状態ではやり直しに使う

重要:

- 単押し、ダブルクリック、長押しの違いは見ません
- どの押され方でも同じ処理です
- 同じ物理ボタンを `redCycle` と `redConfirm` のように複数役割へ再利用できます
- 再利用した場合、その押下で割り当てられた全 role が設定順に実行されます

## 7. 審判ボタンの意味

setup / finished:

- 単押し: 次の設定項目
- ダブルクリック: 前の設定項目
- 長押し: 実行

selection:

- 長押し: ターン開始

active:

- 長押し: レビューへ

review:

- 単押し: 判定項目移動
- ダブルクリック: 値変更
- 長押し: `confirm` 上で結果確定

## 8. 動作確認

1. `npm run dev:with-ble`
2. 起動ログにセンサーと 5 ボタンが `connected` / `ready`
3. `http://localhost:3000/api/state` の `sensor.latestRaw` が変化する
4. `/team/red` `/team/blue` `/` の表示が変わる

## 9. トラブルシュート

### 9.1 `No MESH blocks found`

```bash
npm run ble:stop
npm run ble:discover
```

### 9.2 センサーは動くがプレイヤーボタンが動かない

- `mesh-ble.config.json` が旧構成の可能性があります
- `npm run ble:register` を再実行してください
- ログに `button matched buttonId=redCycle` などが出るか確認してください

### 9.3 成功判定が不自然

- 自動キャリブレーションをやり直す
- `triggerThreshold` を見直す
- ゴール周辺の外光を減らす
