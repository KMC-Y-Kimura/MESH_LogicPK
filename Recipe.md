# MESH Logic PK

MESH Logic PK は、競技「Logic PK」をローカル環境で運用するための判定・選択・表示システムです。

MESH ブロックを使ってゴール成功判定やプレイヤー操作を行い、RED・BLUE・全体表示の3画面で試合進行を管理します。

## 概要

このシステムでは、以下の構成で Logic PK の試合を進行します。

- MESH 明るさブロックによるゴール成功判定
- RED チーム用ボタン2個
- BLUE チーム用ボタン2個
- 審判用ボタン1個
- RED 画面、BLUE 画面、全体画面の3画面表示
- WebSocket によるリアルタイム状態同期

標準運用では、Mac の画面を RED 用、外部モニター1を BLUE 用、外部モニター2を全体表示用として使用します。

## 主な機能

- 試合設定の編集
- チーム名・選手名・基礎点の設定
- ボール利用権の設定
- 投球者・距離・使用ボール・追加得点方向の選択
- 明るさセンサーによる成功検知
- 審判ボタンによる試合進行・レビュー・結果確定
- 試合終了後の勝敗表示
- MESH ブロックの自動登録
- キャリブレーション値の保存

## 画面構成

### 画面パス

| パス | 用途 |
|---|---|
| `/team/red` | RED チーム画面。`setup` 中は設定編集画面 |
| `/team/blue` | BLUE チーム画面。`setup` 中は準備確認画面 |
| `/` | 全体表示画面。試合終了後の結果表示もここで行う |

### 実運用時の画面割り当て

| 画面 | URL |
|---|---|
| Mac | `http://localhost:5173/team/red` |
| モニター1 | `http://localhost:5173/team/blue` |
| モニター2 | `http://localhost:5173/` |

Vite のポートが `5173` 以外になった場合は、起動ログに表示された URL を使用してください。

## MESH ブロック構成

標準構成では、合計6個の MESH ブロックを使用します。

| 論理 ID | 種類 | 用途 |
|---|---|---|
| `goalSensor` | 明るさブロック | ゴール成功判定 |
| `redCycle` | ボタン | RED の候補送り |
| `redConfirm` | ボタン | RED の確定・やり直し |
| `blueCycle` | ボタン | BLUE の候補送り |
| `blueConfirm` | ボタン | BLUE の確定・やり直し |
| `refereeControl` | ボタン | 審判操作 |

現在の実装では、以下の論理ボタンを、それぞれ別々の物理 MESH ボタンに割り当てる必要があります。

- `redCycle`
- `redConfirm`
- `blueCycle`
- `blueConfirm`
- `refereeControl`

同じ物理ボタンを複数の論理ボタンに割り当てると、1回の押下で複数のコマンドが同時に送信され、選択フェーズが壊れる可能性があります。

## 必要環境

- Node.js
- npm
- Bluetooth が使用できる Mac または PC
- MESH 明るさブロック1個
- MESH ボタンブロック5個

## セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/neipia271828/MESH_LogicPK.git
cd MESH_LogicPK
```

### 2. 依存関係のインストール

```bash
npm install
```

## MESH ブロック登録

初回起動時、または MESH ブロックを差し替えた場合は、以下を実行します。

```bash
npm run ble:stop
npm run ble:register
```

登録では、以下の順番で MESH ブロックを割り当てます。

1. `goalSensor`
2. `redCycle`
3. `redConfirm`
4. `blueCycle`
5. `blueConfirm`
6. `refereeControl`

登録結果は `mesh-ble.config.json` に保存されます。

設定テンプレートは `mesh-ble.config.example.json` です。

## 起動方法

### MESH ブロックを使用する場合

実運用では、以下を実行します。

```bash
npm run ble:stop
npm run ble:register
npm run dev:with-ble
```

### Web UI のみを起動する場合

```bash
npm run dev
```

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | Web UI とサーバーを開発モードで起動 |
| `npm run dev:with-ble` | BLE ブリッジ込みで開発モード起動 |
| `npm run ble:discover` | 近くの MESH ブロックを探索 |
| `npm run ble:register` | MESH ブロックを登録 |
| `npm run ble:stop` | BLE ブリッジを停止 |
| `npm run match:reset` | 試合状態をリセットして `setup` に戻す |
| `npm run server:stop` | Node.js サーバーを停止 |
| `npm run build` | サーバーとクライアントをビルド |
| `npm run type-check` | TypeScript の型チェック |

## 試合の基本フロー

1. RED 画面でチーム名・選手名・基礎点・ボール利用権を設定する
2. 審判ボタンで制限時間・先攻チーム・閾値などを設定する
3. ゴールを空にして自動キャリブレーションを行う
4. 審判ボタンで試合を開始する
5. RED・BLUE がそれぞれ選択を行う
6. 両チームの選択が完了したら、審判ボタンの長押しでターンを開始する
7. 投球後、審判ボタンでレビューへ進む
8. 成功・失敗・無効などを確定する
9. 試合終了後、全体画面 `/` に結果を表示する

## プレイヤーボタン操作

RED・BLUE のプレイヤーボタンは、押し方を区別しません。

| ボタン | 動作 |
|---|---|
| Cycle | 候補を1つ進める |
| Confirm | 現在の候補を確定する。確定後はやり直しにも使用する |

### 投げる側の選択順

1. 投球者
2. 距離

### 守る側の選択順

1. ボール
2. 追加得点の向き

追加得点の向きは選択できますが、そのラウンド内で残り権利が0の向きは選択できません。

## 審判ボタン操作

### `setup`・`finished` 中

| 操作 | 動作 |
|---|---|
| 単押し | 次の項目へ移動 |
| ダブルクリック | 前の項目へ移動 |
| 長押し | 現在の項目を実行 |

### 試合中

| フェーズ | 操作 |
|---|---|
| `selection` | 長押しでターン開始 |
| `active` | 長押しでレビューへ移動 |
| `review` | 単押しで判定項目を移動 |
| `review` | ダブルクリックで値を変更 |
| `review` | `confirm` 上で長押しして結果を確定 |

## 表示制限

試合の公平性を保つため、選択内容には以下の表示制限があります。

- 両チームがそのターンの全項目を決めるまでは、相手チームの選択内容は表示されません。
- 全体画面 `/` でも、両チームの選択がそろうまではターン詳細を表示しません。
- 追加得点の向きは、両チームの選択がそろった後も、成功・失敗・無効の結果が確定するまで表示されません。

## 自動キャリブレーション

現在の標準方式は自動キャリブレーションです。

自動キャリブレーションでは、空ゴール時のセンサー値を取り直します。

```text
minRaw = 0
emptyRaw = latestRaw
triggerThreshold = current.triggerThreshold
```

`triggerThreshold` は現在の設定値を維持し、空ゴール時の値である `emptyRaw` だけを更新します。

## リセットと停止

### 試合状態のリセット

試合結果だけを消して `setup` に戻す場合は、以下を実行します。

```bash
npm run match:reset
```

### Node.js サーバーの停止

Node.js サーバーを完全に停止する場合は、以下を実行します。

```bash
npm run server:stop
```

`npm run dev:with-ble` は、すでにポート `3000` で動作しているサーバーを再利用することがあります。

そのため、`Ctrl+C` で停止したつもりでも、別のサーバープロセスが残っていると、前回の状態が表示される場合があります。

## トラブルシュート

### `No MESH blocks found` と表示される

以下を実行します。

```bash
npm run ble:stop
npm run ble:discover
```

次の点を確認してください。

- MESH ブロックの電源が入っているか
- 他の端末や MESH アプリが接続していないか
- PC の Bluetooth が有効になっているか

### センサーは動くがボタンが反応しない

次の点を確認してください。

- `npm run ble:register` を再実行する
- `mesh-ble.config.json` に5つのボタン ID が入っているか確認する
- `npm run dev:with-ble` のログで各ボタンが `ready` になっているか確認する

### `setup` 画面が想定どおりに表示されない

画面の割り当てを確認してください。

| 画面 | パス |
|---|---|
| RED | `/team/red` |
| BLUE | `/team/blue` |
| 全体 | `/` |

`setup` 中に設定を編集できるのは RED 画面だけです。

### 前回の結果が残って見える

前回起動した Node.js サーバーが残っている可能性があります。

ポート `3000` を使用しているプロセスを確認する場合は、以下を実行します。

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

試合状態だけを消す場合は、以下を実行します。

```bash
npm run match:reset
```

サーバー自体を停止する場合は、以下を実行します。

```bash
npm run server:stop
```

## ディレクトリ構成

```text
.
├── client/                       # React / Vite クライアント
├── server/                       # Node.js サーバー
├── scripts/                      # BLE・登録・停止・リセット用スクリプト
├── 音源/                         # 効果音などの音源ファイル
├── mesh-ble.config.example.json  # MESH 設定テンプレート
├── MESH_BLE_DIRECT.md            # BLE 直接接続の説明
├── MESH_BLOCK_REGISTRATION.md    # MESH ブロック登録手順
├── OPERATION_MANUAL.md           # 実運用手順
├── SPEC.md                       # 技術仕様
└── README.md
```

## 関連ドキュメント

詳しい運用方法や技術仕様については、以下のドキュメントを参照してください。

- [`OPERATION_MANUAL.md`](./OPERATION_MANUAL.md)
- [`SPEC.md`](./SPEC.md)
- [`MESH_BLE_DIRECT.md`](./MESH_BLE_DIRECT.md)
- [`MESH_BLOCK_REGISTRATION.md`](./MESH_BLOCK_REGISTRATION.md)

## 現在の前提と制限

- 単一ゴール、明るさセンサー1本を前提としています。
- 成功検知はセンサーで行いますが、得点の確定は審判レビュー後に行います。
- 試合中の操作は MESH ボタンで完結できます。
- チーム名、選手名、基礎点、ボール利用権の編集は RED の `setup` 画面で行います。
- 複数ゴールや複数センサーには現在対応していません。

## 技術スタック

- TypeScript
- React
- Vite
- Express
- WebSocket
- Zustand
- MESH BLE

## ライセンス

MIT